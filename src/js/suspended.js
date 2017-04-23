/*global window, document, chrome, console */
var tabId;

document.getElementById('gsTitle').innerHTML = chrome.extension.getBackgroundPage().gsUtils.getSuspendedTitle(window.location.href);
chrome.tabs.getCurrent(function(tab) {
  tabId = tab.id;
});

(function () {

    var gsUtils = chrome.extension.getBackgroundPage().gsUtils;

    function generateFaviconUri(url, callback) {
        var img = new Image(),
            boxSize = 9;

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
            tabProperties,
            rootUrlStr = gsUtils.getRootUrl(url),
            showPreview = gsUtils.getOption(gsUtils.SCREEN_CAPTURE) !== '0',
            favicon,
            title,
            bodyEl = document.getElementsByTagName('body')[0],
            messageEl = document.getElementById('suspendedMsg'),
            titleEl = document.getElementById('gsTitle'),
            topBarEl = document.getElementById('gsTopBarTitle'),
            whitelistEl = document.getElementById('gsWhitelistLink'),
            linkedUrlEl = document.getElementById('gsLinkedUrl'),
            topBarImgEl = document.getElementById('gsTopBarImg');

        //try to fetch saved tab information for this url
        gsUtils.fetchTabInfo(url).then(function(tabProperties) {

            //if we are missing some suspend information for this tab
            if (!tabProperties) {
                tabProperties = {
                    url: url,
                    favicon: 'chrome://favicon/' + url
                };
            }

            //set preview image
            if (showPreview) {
                gsUtils.fetchPreviewImage(url, function (previewUrl, position) {
                    if (previewUrl && previewUrl !== null) {

                        var previewEl = document.createElement('div');

                        previewEl.innerHTML = document.getElementById("previewTemplate").innerHTML;
                        previewEl.onclick = unsuspendTab;
                        bodyEl.appendChild(previewEl);

                        document.getElementById('gsPreviewImg').setAttribute('src', previewUrl);
                        document.getElementById('gsPreviewImg').addEventListener('load', function() {
                          document.body.scrollTop = position;
                        }, { once: true });

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

            if (tabProperties.fakeTab && tabProperties.url) {
                linkedUrlEl.style.display = 'block';
                linkedUrlEl.setAttribute('href', tabProperties.url);
                linkedUrlEl.innerHTML = tabProperties.url;
                whitelistEl.style.display = 'none';

            } else {
                whitelistEl.innerText = 'Add ' + rootUrlStr + ' to whitelist';
                whitelistEl.setAttribute('data-text', rootUrlStr);
            }
        });
    }

    function unsuspendTab() {
        var url = gsUtils.getSuspendedUrl(window.location.href);
        window.location.replace(url);
    }

    function saveToWhitelist(e) {
        gsUtils.saveToWhitelist(e.target.getAttribute('data-text'));
        unsuspendTab();
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
}());
