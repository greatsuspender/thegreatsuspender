/*global window, document, chrome, console, Image, gsUtils */

(function () {

    'use strict';

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
        img.src = url || chrome.extension.getURL('default.ico');
    }

    function setFavicon(favicon) {
        document.getElementById('gsFavicon').setAttribute('href', favicon);

        setTimeout(function () {
            document.getElementById('gsFavicon').setAttribute('href', favicon);
        }, 1000);
    }

    function attemptTabSuspend() {
        var url = gsUtils.getSuspendedUrl(window.location.hash),
            tabProperties = gsUtils.fetchTabFromHistory(url),
            rootUrlStr,
            showPreview = gsUtils.getOption(gsUtils.SHOW_PREVIEW),
            favicon;

        //just incase the url is a suspension url (somehow??) then decode it
        while (url.indexOf('suspended.html#') >= 0) {
            url = gsUtils.getSuspendedUrl(url.substring(url.indexOf('suspended.html#') + 14));
            window.location.hash = 'url=' + url;
        }
        rootUrlStr = gsUtils.getRootUrl(url);

        //if we are missing some suspend information for this tab
        if (!tabProperties) {
            tabProperties = {url: url};
        }

        //set favicon and preview image
        if (showPreview) {
            gsUtils.fetchPreviewImage(url, function (previewUrl) {
                if (previewUrl !== null) {
                    document.getElementById('suspendedMsg').style.display = 'none';
                    document.getElementById('gsPreview').style.display = 'block';
                    document.getElementById('gsPreviewImg').setAttribute('src', previewUrl);
                } else {
                    document.getElementById('gsPreview').style.display = 'none';
                    document.getElementById('suspendedMsg').style.display = 'table-cell';
                }
            });
        } else {
            document.getElementById('gsPreview').style.display = 'none';
            document.getElementById('suspendedMsg').style.display = 'table-cell';
        }

        favicon = tabProperties.favicon || 'chrome://favicon/' + url;

        generateFaviconUri(favicon, function (faviconUrl) {
            setFavicon(faviconUrl);
        });

        //populate suspended tab bar
        var title = tabProperties.title ? tabProperties.title : rootUrlStr;
        document.getElementById('gsTitle').innerText = title;
        document.getElementById('gsTopBarTitle').innerHTML = '<a href="' + url + '">' + title + '</a>';
        document.getElementById('gsWhitelistLink').innerText = 'Add ' + rootUrlStr + ' to whitelist';
        document.getElementById('gsWhitelistLink').setAttribute('data-text', rootUrlStr);

        document.getElementById('gsTopBarImg').setAttribute('src', favicon);
    }

    function unsuspendTab() {
        var url = gsUtils.getSuspendedUrl(window.location.hash);
        window.location.replace(url);
    }

    function hideNagForever() {
        gsUtils.setOption(gsUtils.NO_NAG, true);
        document.getElementById('dudePopup').style.display = 'none';
        document.getElementById('donateBubble').style.display = 'none';
    }

    window.onload = function () {
        //handler for unsuspend
        document.getElementById('suspendedMsg').onclick = unsuspendTab;
        document.getElementById('gsPreview').onclick = unsuspendTab;

        //handler for whitelist
        document.getElementById('gsWhitelistLink').onclick = function (e) {
            gsUtils.saveToWhitelist(e.target.getAttribute('data-text'));
            unsuspendTab();
        };

        //handler for donate options
        document.getElementById('noDonate').onclick = hideNagForever;
        document.getElementById('donateBubble').onclick = hideNagForever;

        //mark tab as suspended
        //sendSuspendedMessage();

        //try to suspend tab
        attemptTabSuspend();

        //show dude and donate link (randomly 1 of 5 times)
        if (!gsUtils.getOption(gsUtils.NO_NAG) && Math.random() > 0.8) {
            window.addEventListener('focus', function () {
                document.getElementById('dudePopup').setAttribute('class', 'poppedup');
                document.getElementById('donateBubble').setAttribute('class', 'fadeIn');
            });
        }
    };

    /*
    window.onbeforeunload = function () {
        //update url with suspended url
        var url = gsUtils.generateSuspendedUrl(window.location.href);
        window.history.replaceState(null, null, url);
        document.body.style.cursor = 'wait';
    };
    */

}());
