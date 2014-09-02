/*global window, document, chrome, console, Image, gsUtils */

(function() {

    'use strict';

    /*var unsuspending = false;

    function sendSuspendedMessage() {
        if (typeof(chrome.runtime.getManifest()) !== 'undefined') {
            chrome.runtime.sendMessage({action: 'setSuspendedState'});
        }
    }
    function sendUnsuspendedMessage() {
        if (typeof(chrome.runtime.getManifest()) !== 'undefined') {
            chrome.runtime.sendMessage({action: 'setUnsuspendedState'});
        }
    }*/

/*    function unsuspendTab() {

        if (!unsuspending) {

            unsuspending = true;
            sendUnsuspendedMessage();

            document.body.style.cursor = 'wait';

            if (window.history.length > 1) {
                window.history.back();
            } else {
                window.location.reload();
            }
            //window.location.reload();
        }
    }
*/
    function generateFaviconUri(url, callback) {

        var img = new Image(),
            boxSize = 9;
        img.onload = function() {
            var canvas,
                context;
            canvas = window.document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            context = canvas.getContext('2d');
            context.globalAlpha = 0.5;
            context.drawImage(img, 0, 0);
            //context.globalAlpha = 1;
            //context.strokeRect(0, 0, img.width, img.height);
            //context.fillStyle = 'rgb(233, 176, 127)';
            //context.fillStyle = 'rgb(243, 186, 115)';
            /*context.fillStyle = 'rgb(255, 255, 255)';
            context.fillRect(img.width - boxSize, img.height - boxSize, boxSize, boxSize);

            context.fillStyle = 'rgb(0, 0, 0)';
            context.globalAlpha = 1;

            context.fillRect(img.width - boxSize, img.height - boxSize, boxSize, 1);
            context.fillRect(img.width - boxSize, img.height - boxSize, 1, boxSize);
            context.fillRect(img.width - 1, img.height - boxSize, 1, boxSize);
            context.fillRect(img.width - boxSize, img.height - 1, boxSize, 1);

            context.fillRect(img.width - 7, img.height - (boxSize + 1), 3, 1);
            context.fillRect(img.width - 6, img.height - 7, 1, 3);
            context.fillRect(img.width - 4, img.height - 7, 1, 2);
            context.fillRect(img.width - 5, img.height - 3, 2, 1);*/
            callback(canvas.toDataURL());
        };
        img.src = url || chrome.extension.getURL('default.ico');
    }

    function attemptTabSuspend() {

        var url = gsUtils.getHashVariable('url', window.location.hash),
            tabProperties = gsUtils.fetchTabFromHistory(url),
            rootUrlStr,
            showPreview = gsUtils.getOption(gsUtils.SHOW_PREVIEW),
            tidyUrls = gsUtils.getOption(gsUtils.TIDY_URLS);

        //just incase the url is a suspension url (somehow??) then decode it
        while (url.indexOf('suspended.html#') >= 0) {
            url = gsUtils.getHashVariable('url', url.substring(url.indexOf('suspended.html#') + 14));
            window.location.hash = 'url=' + url;
        }
        rootUrlStr = gsUtils.getRootUrl(url);

        //if we are missing some suspend information for this tab
        if (!tabProperties) {
            //console.log('could not fetch tabProperties for tab: ' + url);
            //console.dir(gsUtils.fetchTabFromHistory(url));
            tabProperties = {url: url};
        }

        //set favicon and preview image
        if (showPreview) {
            gsUtils.fetchPreviewImage(url, function(previewUrl) {
                if (previewUrl !== null) {
                    document.getElementById('suspendedMsg').style.display = 'none';
                    document.getElementById('gsPreview').setAttribute('src', previewUrl);
                }
            });
        } else {
            document.getElementById('suspendedMsg').style.display = 'table-cell';
        }

        var favicon = tabProperties.favicon || 'chrome://favicon/' + url;

        document.getElementById('gsFavicon').setAttribute('href', favicon);
        /*generateFaviconUri(favicon, function(faviconUrl) {
            document.getElementById('gsFavicon').setAttribute('href', faviconUrl);
        });*/
        setTimeout(function() {
            document.getElementById('gsFavicon').setAttribute('href', favicon);
        }, 1000);


        //populate suspended tab bar
        document.getElementById('gsTitle').innerText = tabProperties.title ? tabProperties.title : rootUrlStr;
        document.getElementById('gsTopBarTitle').innerText = tabProperties.title ? tabProperties.title : rootUrlStr;
     //   document.getElementById('gsTopBarUrl').innerText = tabProperties.url;
     //   document.getElementById('gsTopBarInfo').innerText = 'Tab suspended: ' + 'click to reload, or ';
        document.getElementById('gsWhitelistLink').innerText = 'Add ' + rootUrlStr + ' to whitelist';
        document.getElementById('gsWhitelistLink').setAttribute('data-text', rootUrlStr);

        document.getElementById('gsTopBarImg').setAttribute('src', favicon);
/*        } else {
            document.getElementById('gsTopBarImg').style.visibility = 'hidden';
        }
*/

        if (tidyUrls) {
            //update url with actual url
            //console.log('replacing state: ' + url);
            window.history.replaceState(null, null, url);
        }
    }

    function unsuspendTab() {

        var url = gsUtils.getHashVariable('url', window.location.hash),
            tidyUrls = gsUtils.getOption(gsUtils.TIDY_URLS);

        //request reload
        try {
            chrome.runtime.sendMessage({action: 'confirmTabUnsuspend'});
        } catch (err) {

            if (tidyUrls) {
                window.location.reload();
            } else {
                window.location.href = url;
            }
        }
    }

    window.onload = function() {

        //handler for unsuspend
        document.getElementById('suspendedMsg').onclick = unsuspendTab;
        document.getElementById('gsPreview').onclick = unsuspendTab;

        //handler for whitelist
        document.getElementById('gsWhitelistLink').onclick = function(e) {
            gsUtils.saveToWhitelist(e.target.getAttribute('data-text'));
        };

        //mark tab as suspended
        //sendSuspendedMessage();

        //try to suspend tab
        attemptTabSuspend();

        //show dude and donate link (randomly 1 of 5 times)
        if (Math.random() > 0.8) {
            window.addEventListener('focus', function() {
                document.getElementById('dudePopup').setAttribute('class', 'poppedup');
                document.getElementById('donateBubble').setAttribute('class','fadeIn');
            });
        }
    };

/*    window.onbeforeunload = function() {

        //update url with suspended url
        var url = gsUtils.generateSuspendedUrl(window.location.href);
        window.history.replaceState(null, null, url);
        document.body.style.cursor = 'wait';
    };
*/
}());
