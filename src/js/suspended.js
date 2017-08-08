/*global window, document, chrome, console */

(function (window) {

    'use strict';

    var tabId;
    var gsUtils = chrome.extension.getBackgroundPage().gsUtils;

    document.getElementById('gsTitle').innerHTML = gsUtils.getSuspendedTitle(window.location.href);
    chrome.tabs.getCurrent(function(tab) {
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
            reloadEl = document.getElementById('gsReloadLink'),
            whitelistEl = document.getElementById('gsWhitelistLink'),
            topBarImgEl = document.getElementById('gsTopBarImg');

        //try to fetch saved tab information for this url
        gsUtils.fetchTabInfo(url).then(function(tabProperties) {

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

                        previewEl.innerHTML = document.getElementById("previewTemplate").innerHTML;
                        previewEl.onclick = unsuspendTab;
                        bodyEl.appendChild(previewEl);

                        document.getElementById('gsPreviewImg').setAttribute('src', preview.img);
                        if (scrollImagePreview) {
                          document.getElementById('gsPreviewImg').addEventListener('load', function() {
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

            whitelistEl.setAttribute('data-root-url', rootUrlStr);
            whitelistEl.setAttribute('data-full-url', fullUrlStr);
            reloadEl.setAttribute('href', url);
        });
    }

    function unsuspendTab() {
        var url = gsUtils.getSuspendedUrl(window.location.href);
        chrome.extension.getBackgroundPage().tgs.scrollPosByTabId[tabId] = gsUtils.getSuspendedScrollPosition(window.location.href);
        document.getElementById('suspendedMsg').innerHTML = "";
        document.getElementById('refreshSpinner').classList.add('spinner');
        window.location.replace(url);
    }

    function saveToWhitelist(e) {
        var fullUrl = e.target.getAttribute('data-full-url');
        var rootUrl = e.target.getAttribute('data-root-url');
        console.log(rootUrl);
        console.log(fullUrl);
        // var whitelistText = window.prompt('Enter string to add to whitelist:', fullUrl);
        // if (whitelistText) {
        //     gsUtils.saveToWhitelist(whitelistText);
        //     unsuspendTab();
        // }

        document.getElementById('fullUrl').innerHTML = rootUrl;

    }

    window.onload = function () {

        document.getElementById('suspendedMsg').onclick = unsuspendTab;
        document.getElementById('gsWhitelistLink').onclick = saveToWhitelist;

        //try to suspend tab
        attemptTabSuspend();

        //set theme
        if (gsUtils.getOption(gsUtils.THEME) === 'dark') {
            document.querySelector('body').className = 'dark';
        }

        //add an unload listener to send an unsuspend request on page unload
        //this will fail if tab is being closed but if page is refreshed it will trigger an unsuspend
        window.addEventListener('beforeunload', function(event) {
            chrome.runtime.sendMessage({
                action: 'requestUnsuspendTab'
            });
        });

        //modal listners
        var modal = document.getElementById('whitelistOptionsModal');
        var btn = document.getElementById('gsWhitelistLink');
        var closeLinks = document.querySelectorAll('.close');

        btn.onclick = function() {
            modal.style.display = "block";
        }
        Array.from(closeLinks).forEach(link => {
            link.addEventListener('click', function(event) {
                modal.style.display = "none";
            });
        });
        // When the user clicks anywhere outside of the modal, close it
        window.onclick = function(event) {
            if (event.target == modal) {
                modal.style.display = "none";
            }
        }

        //show dude and donate link (randomly 1 of 20 times)
        if (!gsUtils.getOption(gsUtils.NO_NAG) && Math.random() > 0.97) {

            function hideNagForever() {
                gsUtils.setOption(gsUtils.NO_NAG, true);
                chrome.extension.getBackgroundPage().tgs.resuspendAllSuspendedTabs();
                document.getElementById('dudePopup').style.display = 'none';
                document.getElementById('donateBubble').style.display = 'none';
            }

            function loadDonateButtons() {
                document.getElementById("donateButtons").innerHTML = this.responseText;
                document.getElementById('donateBubble').onclick = hideNagForever;
            }

            function displayPopup(e) {

                e.target.removeEventListener('focus', displayPopup);

                //generate html for popupDude
                var bodyEl = document.getElementsByTagName('body')[0],
                    donateEl = document.createElement('div');

                donateEl.innerHTML = document.getElementById("donateTemplate").innerHTML;

                bodyEl.appendChild(donateEl);

                var request = new XMLHttpRequest();
                request.onload = loadDonateButtons;
                request.open("GET", "support.html", true);
                request.send();

                document.getElementById('dudePopup').setAttribute('class', 'poppedup');
                document.getElementById('donateBubble').setAttribute('class', 'fadeIn');
            }

            window.addEventListener('focus', displayPopup);
        }
    };

    //tabId is accessed directly from the background script when unsuspending tabs
    window.getTabId = function() {
        return tabId;
    };
    window.requestUnsuspendTab = unsuspendTab;

}(window));
