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
        var preTitle = href.match(titleRegex) ? href.match(titleRegex)[1] : null;
        var preUrl = href.match(urlRegex) ? href.match(urlRegex)[1] : null;
        if (preTitle) {
            preTitle = decodeURIComponent(preTitle);
            document.getElementById('gsTitle').innerHTML = decodeURIComponent(preTitle);
            document.getElementById('gsTopBarTitle').innerHTML = preTitle;
            document.getElementById('gsTopBarTitle').setAttribute('title', preTitle);
        }
        if (preUrl) {
            preUrl = decodeURIComponent(preUrl);
            var faviconUrl = 'chrome://favicon/' + preUrl;
            document.getElementById('gsFavicon').setAttribute('href', faviconUrl);
            document.getElementById('gsTopBarImg').setAttribute('src', faviconUrl);
            document.getElementById('gsTopBarTitle').setAttribute('href', preUrl);
            document.getElementById('suspendedMsg').onclick = function () {
                window.location.replace(preUrl);
            };
            document.getElementById('gsTitleLinks').style.visibility = 'hidden';
        }
        document.getElementById('suspendedMsg').getElementsByTagName('h1')[0].innerHTML = 'Tab suspended';
        document.getElementById('suspendedMsg').getElementsByTagName('h2')[0].innerHTML = 'Refresh or click to reload';

        //update hotkey
        chrome.commands.getAll(function (commands) {
            var hotkeyEl = document.getElementById('hotkeyCommand');
            if (!hotkeyEl) { return; }
            var toggleCommand = commands.find(function (command) {
                return (command.name === '1-suspend-tab');
            });
            if (hotkeyEl && toggleCommand && toggleCommand.shortcut !== '') {
                hotkeyEl.innerHTML = '(' + toggleCommand.shortcut + ')';
            }
            else {
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
        var showPreview = gsStorage.getOption(gsStorage.SCREEN_CAPTURE) !== '0';

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

        //set favicon
        var favicon = tabProperties.favicon;
        generateFaviconUri(favicon, function (faviconUrl) {
            setFavicon(faviconUrl);
        });

        //set theme
        if (gsStorage.getOption(gsStorage.THEME) === 'dark') {
            var body = document.querySelector('body');
            body.className += ' dark';
        }

        //set preview image
        if (showPreview) {
            loadImagePreviewTemplate(url);
        } else {
            document.getElementById('suspendedMsg').style.display = 'table-cell';
        }

        //populate suspended tab bar
        document.getElementById('gsTitle').innerHTML = title;
        document.getElementById('gsTopBarTitle').innerHTML = title;
        document.getElementById('gsTopBarTitle').setAttribute('title', url);
        document.getElementById('gsTopBarTitle').setAttribute('href', url);
        document.getElementById('gsTopBarImg').setAttribute('src', favicon);
        document.getElementById('gsTitleLinks').style.visibility = 'visible';

        //update whitelist text
        var isWhitelisted = gsUtils.checkWhiteList(url);
        if (isWhitelisted) {
            document.getElementById('gsWhitelistLink').innerHTML = chrome.i18n.getMessage('js_suspended_remove_from_whitelist');
        }

        //click listeners
        document.getElementById('suspendedMsg').onclick = handleUnsuspendTab;
        document.getElementById('gsReloadLink').onclick = handleUnsuspendTab;
        document.getElementById('gsTopBarTitle').onclick = handleUnsuspendTab;
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

    function generateFaviconUri(url, callback) {
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

    function setFavicon(favicon) {
        document.getElementById('gsFavicon').setAttribute('href', favicon);
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
        var url = gsUtils.getSuspendedUrl(window.location.href);
        if (url) {
            document.getElementById('suspendedMsg').innerHTML = '';
            document.getElementById('refreshSpinner').classList.add('spinner');
            window.location.replace(url);
        }
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
    }

    function loadImagePreviewTemplate(url) {
        var scrollImagePreview = gsStorage.getOption(gsStorage.SCREEN_CAPTURE) === '2';

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
                document.getElementById('suspendedMsg').style.display = 'none';
                previewEl.style.display = 'block';

                //allow vertical scrollbar if we are using high quality previews
                if (gsStorage.getOption(gsStorage.SCREEN_CAPTURE) === '2') {
                    document.body.style['overflow-x'] = 'auto';
                }
            } else {
                document.getElementById('suspendedMsg').style.display = 'table-cell';
            }
        });
    }

    // listen for background events
    chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
        switch (request.action) {

        case 'initSuspendedTab':
            tabId = request.tabId;
            requestUnsuspendOnReload = true;
            init(request.tabProperties);
            sendResponse({
                action: 'reportTabState',
                status: 'suspended'
            });
            return false;

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

    documentReadyAsPromsied().then(function () {
        localiseHtml();
        preInit();
    });
}());
