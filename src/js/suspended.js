/*global window, document, chrome, Image, XMLHttpRequest */
(function () {
    'use strict';

    var tgs;
    var gsUtils;
    var gsAnalytics;
    var gsStorage;
    var requestUnsuspendOnReload = false;

    var tabId;
    var fullUrlStr;
    var rootUrlStr;

    var preFaviconUrl;
    var preTitle;
    var preUrl;

    var showingDarkTheme = false;
    var showingPreviewValue = false;
    var showingNag = false;
    var currentHotkeyShortcut;

    function documentReadyAsPromsied() {
        return new Promise(function (resolve, reject) {
            if (document.readyState !== 'loading') {
                resolve();
            } else {
                document.addEventListener('DOMContentLoaded', function () {
                    resolve();
                });
            }
        });
    }

    function localiseHtml() {
        var replaceFunc = function (match, p1) {
            return p1 ? chrome.i18n.getMessage(p1) : '';
        };
        Array.prototype.forEach.call(document.getElementsByTagName('*'), function (el) {
            if (el.hasAttribute('data-i18n')) {
                el.innerHTML = el.getAttribute('data-i18n').replace(/__MSG_(\w+)__/g, replaceFunc);
            }
            if (el.hasAttribute('data-i18n-tooltip')) {
                el.setAttribute('data-i18n-tooltip', el.getAttribute('data-i18n-tooltip').replace(/__MSG_(\w+)__/g, replaceFunc));
            }
        });
    }

    function preInit() {
        var href = window.location.href;
        var titleRegex = /ttl=([^&]*)/;
        var urlRegex = /uri=(.*)/;

        var preTitleEncoded = href.match(titleRegex) ? href.match(titleRegex)[1] : null;
        if (preTitleEncoded) {
            preTitle = decodeURIComponent(preTitleEncoded);
            updateTitle(preTitle);
        }

        var preUrlEncoded = href.match(urlRegex) ? href.match(urlRegex)[1] : null;
        if (preUrlEncoded) {
            preUrl = decodeURIComponent(preUrlEncoded);
            updateUrl(preUrl);
            document.getElementById('suspendedMsg').onclick = function () {
                performPageReload(preUrl);
            };
            document.getElementById('gsTopBarTitle').onclick = function () {
                performPageReload(preUrl);
            };

            preFaviconUrl = 'chrome://favicon/' + preUrl;
            updateFavicon(preFaviconUrl);
        }

        document.getElementById('gsTitleLinks').style.visibility = 'hidden';

        getUnsuspendHotkeyShortcut(function (hotkeyShortcut) {
            updateHotkeyText(hotkeyShortcut);
        });
    }

    function init(tabProperties) {

        tgs = chrome.extension.getBackgroundPage().tgs;
        gsUtils = chrome.extension.getBackgroundPage().gsUtils;
        gsAnalytics = chrome.extension.getBackgroundPage().gsAnalytics;
        gsStorage = chrome.extension.getBackgroundPage().gsStorage;

        var url = gsUtils.getSuspendedUrl(window.location.href);
        rootUrlStr = gsUtils.getRootUrl(url);
        fullUrlStr = gsUtils.getRootUrl(url, true);

        //if we are missing some suspend information for this tab
        if (!tabProperties) {
            tabProperties = {
                url: url,
                favicon: 'chrome://favicon/' + url
            };
        }

        var title = tabProperties ? tabProperties.title : '';
        var placeholderTitle = chrome.i18n.getMessage('html_suspended_title');
        if (!title || title === placeholderTitle) {
            title = gsUtils.getSuspendedTitle(window.location.href);
        }
        if (!title || title === placeholderTitle) {
            title = rootUrlStr;
        } else if (title.indexOf('<') >= 0) {
            // Encode any raw html tags that might be used in the title
            title = gsUtils.htmlEncode(title);
        }

        //update favicon
        if (preFaviconUrl !== tabProperties.favicon) {
            updateFavicon(tabProperties.favicon);
        }

        //set theme
        var showDarkTheme = gsStorage.getOption(gsStorage.THEME) === 'dark';
        toggleTheme(showDarkTheme);

        //set preview image
        var showPreview = gsStorage.getOption(gsStorage.SCREEN_CAPTURE) !== '0';
        if (showPreview) {
            loadImagePreviewTemplate(url);
        }

        if (preUrl !== url) {
            updateUrl(url);
        }

        if (preTitle !== title) {
            updateTitle(title);
        }

        //show links
        document.getElementById('gsTitleLinks').style.visibility = 'visible';

        //update unsuspend listeners
        document.getElementById('suspendedMsg').onclick = handleUnsuspendTab;
        document.getElementById('gsTopBarTitle').onclick = handleUnsuspendTab;
        document.getElementById('gsReloadLink').onclick = handleUnsuspendTab;

        //update whitelist
        var isWhitelisted = gsUtils.checkWhiteList(url);
        if (isWhitelisted) {
            document.getElementById('gsWhitelistLink').innerHTML = chrome.i18n.getMessage('js_suspended_remove_from_whitelist');
        }
        document.getElementById('gsWhitelistLink').onclick = function () {
            if (isWhitelisted) {
                unwhitelistTab();
            } else {
                toggleWhitelistModal(true);
            }
        };

        //show dude and donate link (randomly 1 of 33 times)
        if (!gsStorage.getOption(gsStorage.NO_NAG) && Math.random() > 0.97) {
            var donationPopupFocusListener = function (e) {
                e.target.removeEventListener('focus', donationPopupFocusListener);
                loadDonationPopupTemplate();
            };
            window.addEventListener('focus', donationPopupFocusListener);
        }

        //add an unload listener to tell the page to unsuspend on refresh
        //this will fail if tab is being closed but if page is refreshed it will trigger an unsuspend
        window.addEventListener('beforeunload', function (event) {
            if (requestUnsuspendOnReload) {
                tgs.setTabFlagForTabId(tabId, tgs.UNSUSPEND_ON_RELOAD, true);
            }
        });
    }

    function generateFaviconDataUrl(url, callback) {
        var img = new Image();

        img.onload = function () {
            var canvas,
                context;
            canvas = window.document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            context = canvas.getContext('2d');
            context.globalAlpha = 0.5;
            context.drawImage(img, 0, 0);

            callback(canvas.toDataURL());
        };
        img.src = url || chrome.extension.getURL('img/default.ico');
    }

    function updateTitle(title) {
        document.getElementById('gsTitle').innerHTML = title;
        document.getElementById('gsTopBarTitle').innerHTML = title;
    }

    function updateUrl(url) {
        document.getElementById('gsTopBarTitle').setAttribute('title', url);
        document.getElementById('gsTopBarTitle').setAttribute('href', url);
    }

    function updateFavicon(faviconUrl) {
        document.getElementById('gsTopBarImg').setAttribute('src', faviconUrl);
        generateFaviconDataUrl(faviconUrl, function (dataUrl) {
            document.getElementById('gsFavicon').setAttribute('href', dataUrl);
        });
    }

    function getUnsuspendHotkeyShortcut(callback) {
        chrome.commands.getAll(function (commands) {
            var toggleCommand = commands.find(function (command) {
                return (command.name === '1-suspend-tab');
            });
            if (toggleCommand && toggleCommand.shortcut !== '') {
                callback(toggleCommand.shortcut);
            } else {
                callback(null);
            }
        });
    }

    function updateHotkeyText(hotkeyShortcut) {
        currentHotkeyShortcut = hotkeyShortcut;
        var hotkeyEl = document.getElementById('hotkeyCommand');
        if (hotkeyShortcut) {
            hotkeyShortcut = hotkeyShortcut
                .replace(/Command/, '\u2318')
                .replace(/Shift/, '\u21E7')
                .replace(/Control/, '^')
                .replace(/\+/g, ' ');
            hotkeyEl.innerHTML = '(' + hotkeyShortcut + ')';
        }
        else {
            hotkeyEl.innerHTML = '';
            var shortcutNotSetEl = document.createElement('a');
            shortcutNotSetEl.innerHTML = chrome.i18n.getMessage('js_suspended_hotkey_to_reload');
            shortcutNotSetEl.innerHTML = chrome.i18n.getMessage('js_shortcuts_not_set');
            hotkeyEl.insertAdjacentHTML('beforeend', '(' + chrome.i18n.getMessage('js_suspended_hotkey_to_reload') + ': ');
            hotkeyEl.appendChild(shortcutNotSetEl);
            hotkeyEl.insertAdjacentHTML('beforeend', ')');
            hotkeyEl.onclick = function (e) {
                e.stopPropagation();
                chrome.tabs.create({url: 'chrome://extensions/configureCommands'});
            };
        }
    }

    function handleUnsuspendTab(e) {
        // dont want to pass the event arg along to the unsuspendTab function!!
        e.preventDefault();
        unsuspendTab();
    }

    function unsuspendTab(addToTemporaryWhitelist) {
        if (addToTemporaryWhitelist) {
            tgs.setTabFlagForTabId(tabId, tgs.TEMP_WHITELIST_ON_RELOAD, true);
        }
        var scrollPosition = gsUtils.getSuspendedScrollPosition(window.location.href);
        if (scrollPosition) {
            tgs.setTabFlagForTabId(tabId, tgs.SCROLL_POS, scrollPosition);
        }
        var url = gsUtils.getSuspendedUrl(window.location.href) || preUrl;
        performPageReload(url);
    }

    function performPageReload(url) {
        document.getElementById('suspendedMsg').innerHTML = '';
        document.getElementById('refreshSpinner').classList.add('spinner');
        window.location.replace(url);
    }

    function whitelistTab(whitelistString) {
        gsUtils.saveToWhitelist(whitelistString);
        toggleWhitelistModal(false);
        unsuspendTab();
    }

    function unwhitelistTab() {
        gsUtils.removeFromWhitelist(rootUrlStr);
        gsUtils.removeFromWhitelist(fullUrlStr);
        toggleWhitelistModal(false);
        unsuspendTab();
    }

    function temporarilyWhitelistTab() {
        toggleWhitelistModal(false);
        unsuspendTab(true);
    }

    function toggleWhitelistModal(visible) {
        if (!document.getElementById('whitelistOptionsModal')) {
            loadWhitelistModalTemplate();
        }
        document.getElementById('whitelistOptionsModal').style.display = visible ? 'block' : 'none';
    }

    function showNoConnectivityMessage() {
        if (!document.getElementById('disconnectedNotice')) {
            loadToastTemplate();
        }
        document.getElementById('disconnectedNotice').style.display = 'none';
        setTimeout(function () {
            document.getElementById('disconnectedNotice').style.display = 'block';
        }, 50);
    }

    function loadWhitelistModalTemplate() {
        var modalEl = document.createElement('div');
        modalEl.setAttribute('id', 'whitelistOptionsModal');
        modalEl.classList.add('modal-wrapper');
        modalEl.innerHTML = document.getElementById('whitelistModalTemplate').innerHTML;
        gsUtils.localiseHtml(modalEl);
        document.getElementsByTagName('body')[0].appendChild(modalEl);

        //update whitelist text
        document.getElementById('rootUrl').innerHTML = rootUrlStr;
        document.getElementById('fullUrl').innerHTML = fullUrlStr;
        //whitelistPageEl.innerHTML = fullUrlStr;

        // hide second option (whitelist page) if the url is the same as the root url
        if (rootUrlStr === fullUrlStr) {
            document.getElementById('whitelistPage').parentElement.style.display = 'none';
        }

        document.getElementById('confirmWhitelistBtn').onclick = function () {
            if (document.getElementById('whitelistSite').checked && rootUrlStr) {
                whitelistTab(rootUrlStr);
            } else if (document.getElementById('whitelistPage').checked && fullUrlStr) {
                whitelistTab(fullUrlStr);
            } else {
                temporarilyWhitelistTab();
            }
        };

        // When the user clicks anywhere outside of the modal, close it
        window.onclick = function (event) {
            if (event.target === document.getElementById('whitelistOptionsModal')) {
                toggleWhitelistModal(false);
            }
        };

        Array.from(document.querySelectorAll('.close')).forEach(function (link) {
            link.addEventListener('click', function (event) {
                toggleWhitelistModal(false);
            });
        });
    }

    function loadToastTemplate() {
        var toastEl = document.createElement('div');
        toastEl.setAttribute('id', 'disconnectedNotice');
        toastEl.classList.add('toast-wrapper');
        toastEl.innerHTML = document.getElementById('toastTemplate').innerHTML;
        gsUtils.localiseHtml(toastEl);
        document.getElementsByTagName('body')[0].appendChild(toastEl);
    }

    function loadDonateButtonsHtml() {
        document.getElementById('donateButtons').innerHTML = this.responseText;

        document.getElementById('bitcoinBtn').innerHTML = chrome.i18n.getMessage('js_donate_bitcoin');
        document.getElementById('bitcoinBtn').onclick = function () {
            gsAnalytics.reportEvent('Donations', 'Click', 'bitcoin');
        };

        document.getElementById('paypalBtn').setAttribute('value', chrome.i18n.getMessage('js_donate_paypal'));
        document.getElementById('paypalBtn').onclick = function () {
            gsAnalytics.reportEvent('Donations', 'Click', 'paypal');
        };
    }

    function loadDonationPopupTemplate() {
        //if user has donated since this page was first generated then dont display popup
        if (gsStorage.getOption(gsStorage.NO_NAG)) { return; }

        var popupEl = document.createElement('div');
        popupEl.innerHTML = document.getElementById('donateTemplate').innerHTML;
        gsUtils.localiseHtml(popupEl);
        document.getElementsByTagName('body')[0].appendChild(popupEl);

        var request = new XMLHttpRequest();
        request.onload = loadDonateButtonsHtml;
        request.open('GET', 'support.html', true);
        request.send();

        document.getElementById('dudePopup').setAttribute('class', 'poppedup');
        document.getElementById('donateBubble').setAttribute('class', 'fadeIn');
        showingNag = true;
    }

    function hideDonationPopup() {
        document.getElementById('dudePopup').classList.remove('poppedup');
        document.getElementById('donateBubble').classList.remove('fadeIn');
        showingNag = false;
    }

    function loadImagePreviewTemplate(url) {
        var previewValue = gsStorage.getOption(gsStorage.SCREEN_CAPTURE);
        var scrollImagePreview = previewValue === '2';

        gsStorage.fetchPreviewImage(url, function (preview) {
            if (preview && preview.img && preview.img !== null && preview.img !== 'data:,' && preview.img.length > 10000) {

                var previewEl = document.createElement('div');
                previewEl.innerHTML = document.getElementById('previewTemplate').innerHTML;
                gsUtils.localiseHtml(previewEl);
                previewEl.onclick = handleUnsuspendTab;
                document.getElementsByTagName('body')[0].appendChild(previewEl);

                document.getElementById('gsPreviewImg').setAttribute('src', preview.img);
                if (scrollImagePreview) {
                    var scrollPos = gsUtils.getSuspendedScrollPosition(window.location.href);
                    document.getElementById('gsPreviewImg').addEventListener('load', function () {
                        document.body.scrollTop = scrollPos || 0;
                    }, { once: true });
                }
                toggleImagePreviewVisibility(previewValue);
            } else {
                toggleImagePreviewVisibility(previewValue);
            }
        });
    }

    function toggleImagePreviewVisibility(previewValue) {
        showingPreviewValue = previewValue;
        if (!document.getElementById('gsPreview')) {
            return;
        }
        var overflow = previewValue === '2' ? 'auto' : 'hidden';
        document.body.style['overflow-x'] = overflow;

        if (previewValue === '0') {
            document.getElementById('gsPreview').style.display = 'none';
            document.getElementById('suspendedMsg').style.display = 'table-cell';
        } else {
            document.getElementById('gsPreview').style.display = 'block';
            document.getElementById('suspendedMsg').style.display = 'none';
        }
    }

    function toggleTheme(showDarkTheme) {
        if (showDarkTheme) {
            document.querySelector('body').classList.add('dark');
            showingDarkTheme = true;
        } else {
            document.querySelector('body').classList.remove('dark');
            showingDarkTheme = false;
        }
    }

    function addMessageListeners() {
        chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
            switch (request.action) {

            case 'initSuspendedTab':
                tabId = request.tabId;
                requestUnsuspendOnReload = true;
                init(request.tabProperties);
                break;

            case 'refreshSuspendedTab':
                var showDarkTheme = gsStorage.getOption(gsStorage.THEME) === 'dark';
                if ((showDarkTheme && !showingDarkTheme) || (!showDarkTheme && showingDarkTheme)) {
                    toggleTheme(showDarkTheme);
                }
                var hideNag = gsStorage.getOption(gsStorage.NO_NAG);
                if (hideNag && showingNag) {
                    hideDonationPopup();
                }
                var previewValue = gsStorage.getOption(gsStorage.SCREEN_CAPTURE);
                if (previewValue !== showingPreviewValue) {
                    toggleImagePreviewVisibility(previewValue);
                }
                getUnsuspendHotkeyShortcut(function (hotkeyShortcut) {
                    if (hotkeyShortcut !== currentHotkeyShortcut) {
                        updateHotkeyText(hotkeyShortcut);
                    }
                });
                break;

            case 'unsuspendTab':
                unsuspendTab();
                break;

            case 'disableUnsuspendOnReload':
                requestUnsuspendOnReload = false;
                break;

            case 'showNoConnectivityMessage':
                showNoConnectivityMessage();
                break;
            }
            sendResponse();
            return false;
        });
    }

    documentReadyAsPromsied().then(function () {
        localiseHtml();
        preInit();
        init();
        addMessageListeners();
    });
}());
