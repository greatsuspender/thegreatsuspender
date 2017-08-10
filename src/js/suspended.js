/*global window, document, chrome, console, Image, XMLHttpRequest */
(function (window) {
    'use strict';

    var tabId;
    var gsUtils = chrome.extension.getBackgroundPage().gsUtils;

    document.getElementById('gsTitle').innerHTML = gsUtils.getSuspendedTitle(window.location.href);
    chrome.tabs.getCurrent(function (tab) {
        tabId = tab.id;
    });

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

    function attemptTabSuspend() {
        var url = gsUtils.getSuspendedUrl(window.location.href),
            rootUrlStr = gsUtils.getRootUrl(url),
            fullUrlStr = gsUtils.getRootUrl(url, true),
            scrollPos = gsUtils.getSuspendedScrollPosition(window.location.href),
            showPreview = gsUtils.getOption(gsUtils.SCREEN_CAPTURE) !== '0',
            scrollImagePreview = gsUtils.getOption(gsUtils.SCREEN_CAPTURE) === '2',
            favicon,
            title,
            bodyEl = document.getElementsByTagName('body')[0],
            messageEl = document.getElementById('suspendedMsg'),
            titleEl = document.getElementById('gsTitle'),
            topBarEl = document.getElementById('gsTopBarTitle'),
            topBarImgEl = document.getElementById('gsTopBarImg'),
            whitelistSiteEl = document.getElementById('whitelistSite'),
            whitelistPageEl = document.getElementById('whitelistPage'),
            whitelistTempEl = document.getElementById('whitelistTemporary'),
            confirmWhitelistBtnEl = document.getElementById('confirmWhitelistBtn');

        //try to fetch saved tab information for this url
        gsUtils.fetchTabInfo(url).then(function (tabProperties) {

            //if we are missing some suspend information for this tab
            if (!tabProperties) {
                tabProperties = {
                    url: url,
                    favicon: 'chrome://favicon/size/16@2x/' + url
                };
            }

            //set preview image
            if (showPreview) {
                gsUtils.fetchPreviewImage(url, function (preview) {
                    if (preview && preview.img && preview.img !== null) {

                        var previewEl = document.createElement('div');

                        previewEl.innerHTML = document.getElementById('previewTemplate').innerHTML;
                        previewEl.onclick = unsuspendTab;
                        bodyEl.appendChild(previewEl);

                        document.getElementById('gsPreviewImg').setAttribute('src', preview.img);
                        if (scrollImagePreview) {
                            document.getElementById('gsPreviewImg').addEventListener('load', function () {
                                document.body.scrollTop = scrollPos || 0;
                            }, { once: true });
                        }
                        messageEl.style.display = 'none';
                        previewEl.style.display = 'block';
                    }
                });

                //allow vertical scrollbar if we are using high quality previews
                if (gsUtils.getOption(gsUtils.SCREEN_CAPTURE) === '2') {
                    document.body.style['overflow-x'] = 'auto';
                }

            } else {
                messageEl.style.display = 'table-cell';
            }

            //set favicon
            favicon = tabProperties.favicon;

            generateFaviconUri(favicon, function (faviconUrl) {
                setFavicon(faviconUrl);
            });

            //populate suspended tab bar
            title = tabProperties.title ? tabProperties.title : rootUrlStr;
            title = title.indexOf('<') < 0 ? title : gsUtils.htmlEncode(title);
            titleEl.innerHTML = title;
            topBarEl.innerHTML = title;
            topBarEl.setAttribute('href', url);
            topBarImgEl.setAttribute('src', favicon);

            //populate modal
            confirmWhitelistBtnEl.setAttribute('data-root-url', rootUrlStr);
            confirmWhitelistBtnEl.setAttribute('data-full-url', fullUrlStr);
            console.log(rootUrlStr);
            console.log(fullUrlStr);
            //whitelistSiteEl.innerHTML = rootUrlStr;
            //whitelistPageEl.innerHTML = fullUrlStr;
        });
    }

    function unsuspendTab() {
        var url = gsUtils.getSuspendedUrl(window.location.href);
        chrome.extension.getBackgroundPage().tgs.scrollPosByTabId[tabId] = gsUtils.getSuspendedScrollPosition(window.location.href);
        document.getElementById('suspendedMsg').innerHTML = '';
        document.getElementById('refreshSpinner').classList.add('spinner');
        window.location.replace(url);
    }

    function whitelistTab() {
        var confirmWhitelistBtnEl = document.getElementById('confirmWhitelistBtn');
        var whitelistSiteEl = document.getElementById('whitelistSite');
        var whitelistPageEl = document.getElementById('whitelistPage');
        var whitelistTempEl = document.getElementById('whitelistTemporary');

        var rootUrlStr = confirmWhitelistBtnEl.getAttribute('data-root-url');
        var fullUrlStr = confirmWhitelistBtnEl.getAttribute('data-full-url');

        if (whitelistSiteEl.checked && rootUrlStr) {
            gsUtils.saveToWhitelist(rootUrlStr);
        } else if (whitelistPageEl.checked && fullUrlStr) {
            gsUtils.saveToWhitelist(fullUrlStr);
        } else {
            // not implemented yet
        }

        toggleModal(false);
        unsuspendTab();
    }

    function toggleModal(visible) {
        var modalEl = document.getElementById('whitelistOptionsModal');
        modalEl.style.display = visible ? 'block' : 'none';
    }

    function hideNagForever() {
        gsUtils.setOption(gsUtils.NO_NAG, true);
        chrome.extension.getBackgroundPage().tgs.resuspendAllSuspendedTabs();
        document.getElementById('dudePopup').style.display = 'none';
        document.getElementById('donateBubble').style.display = 'none';
    }

    function loadDonateButtons() {
        document.getElementById('donateButtons').innerHTML = this.responseText;
        document.getElementById('donateBubble').onclick = hideNagForever;
    }

    function displayPopup(e) {

        e.target.removeEventListener('focus', displayPopup);

        //generate html for popupDude
        var bodyEl = document.getElementsByTagName('body')[0],
            donateEl = document.createElement('div');

        donateEl.innerHTML = document.getElementById('donateTemplate').innerHTML;

        bodyEl.appendChild(donateEl);

        var request = new XMLHttpRequest();
        request.onload = loadDonateButtons;
        request.open('GET', 'support.html', true);
        request.send();

        document.getElementById('dudePopup').setAttribute('class', 'poppedup');
        document.getElementById('donateBubble').setAttribute('class', 'fadeIn');
    }

    gsUtils.documentReadyAsPromsied(document).then(function () {

        var suspendedMsgEl = document.getElementById('suspendedMsg');
        var reloadLinkEl = document.getElementById('gsReloadLink');
        var showWhitelistModalEl = document.getElementById('gsWhitelistLink');
        var confirmWhitelistBtnEl = document.getElementById('confirmWhitelistBtn');
        var modalEl = document.getElementById('whitelistOptionsModal');
        var closeLinkEls = document.querySelectorAll('.close');

        //try to suspend tab
        attemptTabSuspend();

        //set theme
        if (gsUtils.getOption(gsUtils.THEME) === 'dark') {
            var body = document.querySelector('body');
            body.className += ' dark';
        }

        //add an unload listener to send an unsuspend request on page unload
        //this will fail if tab is being closed but if page is refreshed it will trigger an unsuspend
        window.addEventListener('beforeunload', function (event) {
            chrome.runtime.sendMessage({
                action: 'requestUnsuspendTab'
            });
        });

        //click listeners
        suspendedMsgEl.onclick = unsuspendTab;
        reloadLinkEl.onclick = unsuspendTab;
        confirmWhitelistBtnEl.onclick = whitelistTab;

        showWhitelistModalEl.onclick = function () {
            toggleModal(true);
        };

        Array.from(closeLinkEls).forEach(function (link) {
            link.addEventListener('click', function (event) {
                toggleModal(false);
            });
        });

        // When the user clicks anywhere outside of the modal, close it
        window.onclick = function (event) {
            if (event.target === modalEl) {
                toggleModal(false);
            }
        };

        //show dude and donate link (randomly 1 of 20 times)
        if (!gsUtils.getOption(gsUtils.NO_NAG) && Math.random() > 0.97) {
            window.addEventListener('focus', displayPopup);
        }

        //tabId is accessed directly from the background script when unsuspending tabs
        window.getTabId = function () {
            return tabId;
        };
        window.requestUnsuspendTab = unsuspendTab;
    });
}(window));
