/*global window, document, chrome, console, Image, XMLHttpRequest */
(function () {
    'use strict';

    var tgs = chrome.extension.getBackgroundPage().tgs;
    var gsUtils = chrome.extension.getBackgroundPage().gsUtils;
    var url = gsUtils.getSuspendedUrl(window.location.href);
    var requestUnsuspendOnReload = false;

    Promise.all([gsUtils.documentReadyAndLocalisedAsPromsied(document), gsUtils.fetchTabInfo(url)])
        .then(function ([domLoadedEvent, tabProperties]) {
            init(tabProperties);
        });

    function init(tabProperties) {

        //if we are missing some suspend information for this tab
        if (!tabProperties) {
            tabProperties = {
                url: url,
                favicon: 'chrome://favicon/' + url
            };
        }

        var rootUrlStr = gsUtils.getRootUrl(url),
            fullUrlStr = gsUtils.getRootUrl(url, true),
            scrollPos = gsUtils.getSuspendedScrollPosition(window.location.href),
            showPreview = gsUtils.getOption(gsUtils.SCREEN_CAPTURE) !== '0',
            scrollImagePreview = gsUtils.getOption(gsUtils.SCREEN_CAPTURE) === '2';

        //set title
        document.getElementById('gsTitle').innerHTML = gsUtils.getSuspendedTitle(window.location.href);

        //set favicon
        var favicon = tabProperties.favicon;
        generateFaviconUri(favicon, function (faviconUrl) {
            setFavicon(faviconUrl);
        });

        //set theme
        if (gsUtils.getOption(gsUtils.THEME) === 'dark') {
            var body = document.querySelector('body');
            body.className += ' dark';
        }

        //set preview image
        if (showPreview) {
            gsUtils.fetchPreviewImage(url, function (preview) {
                if (preview && preview.img && preview.img !== null && preview.img !== 'data:,') {

                    var previewEl = document.createElement('div');
                    previewEl.innerHTML = document.getElementById('previewTemplate').innerHTML;
                    gsUtils.localiseHtml(previewEl);
                    previewEl.onclick = handleUnsuspendTab;
                    document.getElementsByTagName('body')[0].appendChild(previewEl);

                    document.getElementById('gsPreviewImg').setAttribute('src', preview.img);
                    if (scrollImagePreview) {
                        document.getElementById('gsPreviewImg').addEventListener('load', function () {
                            document.body.scrollTop = scrollPos || 0;
                        }, { once: true });
                    }
                    document.getElementById('suspendedMsg').style.display = 'none';
                    previewEl.style.display = 'block';

                    //allow vertical scrollbar if we are using high quality previews
                    if (gsUtils.getOption(gsUtils.SCREEN_CAPTURE) === '2') {
                        document.body.style['overflow-x'] = 'auto';
                    }
                } else {
                    document.getElementById('suspendedMsg').style.display = 'table-cell';
                }
            });

        } else {
            document.getElementById('suspendedMsg').style.display = 'table-cell';
        }

        //populate suspended tab bar
        var title = tabProperties.title ? tabProperties.title : rootUrlStr;
        title = title.indexOf('<') < 0 ? title : gsUtils.htmlEncode(title);
        document.getElementById('gsTitle').innerHTML = title;
        document.getElementById('gsTopBarTitle').innerHTML = title;
        document.getElementById('gsTopBarTitle').setAttribute('title', url);
        document.getElementById('gsTopBarTitle').setAttribute('href', url);
        document.getElementById('gsTopBarImg').setAttribute('src', favicon);

        //update whitelist text
        var isWhitelisted = gsUtils.checkWhiteList(url);
        if (isWhitelisted) {
            document.getElementById('gsWhitelistLink').innerHTML = chrome.i18n.getMessage('js_suspended_remove_from_whitelist');

        //populate modal
        } else {
            document.getElementById('rootUrl').innerHTML = rootUrlStr;
            document.getElementById('fullUrl').innerHTML = fullUrlStr;
            //whitelistPageEl.innerHTML = fullUrlStr;
        }

        //click listeners
        document.getElementById('suspendedMsg').onclick = handleUnsuspendTab;
        document.getElementById('gsReloadLink').onclick = handleUnsuspendTab;
        document.getElementById('gsWhitelistLink').onclick = function () {
            if (isWhitelisted) {
                unwhitelistTab(rootUrlStr, fullUrlStr);
            } else {
                // hide second option (whitelist page) if the url is the same as the root url
                if (rootUrlStr === fullUrlStr) {
                    document.getElementById('whitelistPage').parentElement.style.display = 'none';
                }
                toggleModal(true);
            }
        };
        document.getElementById('confirmWhitelistBtn').onclick = function () {
            if (document.getElementById('whitelistSite').checked && rootUrlStr) {
                whitelistTab(rootUrlStr);
            } else if (document.getElementById('whitelistPage').checked && fullUrlStr) {
                whitelistTab(fullUrlStr);
            } else {
                temporarilyWhitelistTab();
            }
        };

        Array.from(document.querySelectorAll('.close')).forEach(function (link) {
            link.addEventListener('click', function (event) {
                toggleModal(false);
            });
        });

        // When the user clicks anywhere outside of the modal, close it
        window.onclick = function (event) {
            if (event.target === document.getElementById('whitelistOptionsModal')) {
                toggleModal(false);
            }
        };

        //show dude and donate link (randomly 1 of 33 times)
        if (!gsUtils.getOption(gsUtils.NO_NAG) && Math.random() > 0.97) {
            window.addEventListener('focus', displayPopup);
        }

        //add an unload listener to tell the page to unsuspend on refresh
        //this will fail if tab is being closed but if page is refreshed it will trigger an unsuspend
        window.addEventListener('beforeunload', function (event) {
            if (requestUnsuspendOnReload) {
                chrome.runtime.sendMessage({ action: 'requestUnsuspendOnReload' });
            }
        });

        var payload = {
            action: 'reportTabState',
            status: 'suspended'
        };
        chrome.runtime.sendMessage(payload);
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
        // dont want to pass the event arg along to the requestUnsuspendTab function!!
        requestUnsuspendTab();
    }

    function requestUnsuspendTab(addToTemporaryWhitelist) {
        var payload = {
            action: 'requestUnsuspendTab',
            addToTemporaryWhitelist: addToTemporaryWhitelist
        };
        chrome.runtime.sendMessage(payload, function (response) {
            if (chrome.runtime.lastError) {
                console.log('Error requesting unsuspendTab. Will unsuspend locally.', chrome.runtime.lastError);
                unsuspendTab();
            }
        });
    }

    function unsuspendTab() {
        var url = gsUtils.getSuspendedUrl(window.location.href);
        if (url) {
            document.getElementById('suspendedMsg').innerHTML = '';
            document.getElementById('refreshSpinner').classList.add('spinner');
            window.location.replace(url);
        }
    }

    function whitelistTab(whitelistString) {
        gsUtils.saveToWhitelist(whitelistString);
        toggleModal(false);
        requestUnsuspendTab();
    }

    function unwhitelistTab(rootUrlStr, fullUrlStr) {
        gsUtils.removeFromWhitelist(rootUrlStr);
        gsUtils.removeFromWhitelist(fullUrlStr);
        toggleModal(false);
        requestUnsuspendTab();
    }

    function temporarilyWhitelistTab() {
        toggleModal(false);
        requestUnsuspendTab(true);
    }

    function showNoConnectivityMessage() {
        document.getElementById('disconnectedNotice').style.display = 'none';
        setTimeout(function () {
            document.getElementById('disconnectedNotice').style.display = 'block';
        }, 50);
    }

    function toggleModal(visible) {
        document.getElementById('whitelistOptionsModal').style.display = visible ? 'block' : 'none';
    }

    function hideNagForever() {
        gsUtils.setOption(gsUtils.NO_NAG, true);
        tgs.resuspendAllSuspendedTabs();
        document.getElementById('dudePopup').style.display = 'none';
        document.getElementById('donateBubble').style.display = 'none';
    }

    function loadDonateButtons() {
        document.getElementById('donateButtons').innerHTML = this.responseText;
        document.getElementById('donateBubble').onclick = hideNagForever;

        document.getElementById('bitcoinBtn').innerHTML = chrome.i18n.getMessage('js_donate_bitcoin');
        document.getElementById('paypalBtn').setAttribute('value', chrome.i18n.getMessage('js_donate_paypal'));
    }

    function displayPopup(e) {

        e.target.removeEventListener('focus', displayPopup);

        //generate html for popupDude
        var popupEl = document.createElement('div');
        popupEl.innerHTML = document.getElementById('donateTemplate').innerHTML;
        gsUtils.localiseHtml(popupEl);
        document.getElementsByTagName('body')[0].appendChild(popupEl);

        var request = new XMLHttpRequest();
        request.onload = loadDonateButtons;
        request.open('GET', 'support.html', true);
        request.send();

        document.getElementById('dudePopup').setAttribute('class', 'poppedup');
        document.getElementById('donateBubble').setAttribute('class', 'fadeIn');
    }

    //listen for background events
    chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
        switch (request.action) {

        case 'unsuspendTab':
            unsuspendTab();
            sendResponse({ result: 'done' });
            return false;

        case 'setUnsuspendOnReload':
            requestUnsuspendOnReload = request.value || false;
            sendResponse({ result: 'done' });
            return false;

        case 'showNoConnectivityMessage':
            showNoConnectivityMessage();
            sendResponse({ result: 'done' });
            return false;
        }
    });
}());
