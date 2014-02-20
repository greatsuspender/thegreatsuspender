/*global window, document, chrome, console, Image, gsStorage */

var referrer = false;

(function() {

    'use strict';

    function generateFaviconUri(url, callback) {

        var img = new Image();
        img.onload = function() {
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

    function sendSuspendedMessage() {
        chrome.runtime.sendMessage({action: 'setSuspendedState'});
    }
    function sendUnsuspendedMessage() {
        chrome.runtime.sendMessage({action: 'setUnsuspendedState'});
    }
    function sendConfirmUnsuspensionMessage() {
        chrome.runtime.sendMessage({action: 'confirmUnsuspension'});
    }

    function unsuspendTab() {

        var extensionTest = chrome.runtime.getManifest();

        if (typeof(extensionTest) !== "undefined") {
            sendConfirmUnsuspensionMessage();

        } else {
            window.location.reload();
        }
    }

    function generateMetaImages(tabProperties) {

        var faviconUrl,
            showPreview = gsStorage.fetchPreviewOption();

        if (showPreview) {
            gsStorage.fetchPreviewImage(tabProperties.url, function(previewUrl) {
                if (previewUrl !== null) {
                    document.getElementById('gsPreview').setAttribute('src', previewUrl);
                }
            });
        }

        generateFaviconUri(tabProperties.favicon, function(faviconUrl) {
            document.getElementById('gsFavicon').setAttribute('href', faviconUrl);
        });
    }

    function attemptTabSuspend() {

        var //tab = tabsArray[0],
            url = gsStorage.getHashVariable('url', window.location.hash),
            tabProperties = gsStorage.fetchTabFromHistory(url);

        //if we have some suspend information for this tab
        if (tabProperties) {
            console.log('about to suspend tab: ' + url);
            generateMetaImages(tabProperties);

        //else create new tabProperties object
        } else {
            tabProperties = {url: url};
            console.log('recovering tab');
        }


        //populate suspended tab bar
        var rootUrlStr = tabProperties.url,
        rootUrlStr = rootUrlStr.indexOf('//') > 0 ? rootUrlStr.substring(rootUrlStr.indexOf('//') + 2) : rootUrlStr;
        rootUrlStr = rootUrlStr.substring(0, rootUrlStr.indexOf('/'));

        document.getElementById('gsTitle').innerText = tabProperties.title ? tabProperties.title : rootUrlStr;
        document.getElementById('gsTopBarTitle').innerText = tabProperties.title ? tabProperties.title : rootUrlStr;
        document.getElementById('gsTopBarUrl').innerText = tabProperties.url;
        document.getElementById('gsTopBarInfo').innerText = 'Tab suspended: click to reload OR ';
        document.getElementById('gsWhitelistLink').innerText = 'add ' + rootUrlStr + ' to whitelist';
        document.getElementById('gsWhitelistLink').setAttribute('data-text', rootUrlStr);

        if (tabProperties.favicon) {
            document.getElementById('gsTopBarImg').setAttribute('src', tabProperties.favicon);
        } else {
            document.getElementById('gsTopBarImg').style.visibility = 'hidden';
        }

        //mark tab as suspended
        sendSuspendedMessage();

        //update url with actual url
        //not sure why but restoring this url crashes the extension?!?!?!
        if (url.indexOf('chrome.google.com/webstore') < 0) {
            window.history.replaceState(null, null, url);
        }
    }

    /*function tabListener(request, sender, sendResponse) {
        console.dir('received suspended.js message:' + request.action + ' [' + Date.now() + '] ');
        if (request.action === 'unsuspendTab') {
            unsuspendTab();
        }
    }*/

    window.onload = function() {

        //chrome.runtime.onMessage.addListener(tabListener);

        //handler for unsuspend
        document.onclick = unsuspendTab;

        //handler for whitelist
        document.getElementById('gsWhitelistLink').onclick = function(e) {
            gsStorage.saveToWhitelist(e.target.getAttribute('data-text'));
        };

        //try to suspend tab
        //chrome.tabs.query({active: true, currentWindow: true}, attemptTabSuspend);
        attemptTabSuspend();
    };

    window.onbeforeunload = function() {

        //update url with suspended url
        window.history.replaceState(null, null, gsStorage.generateSuspendedUrl(window.location.href));
    };

}());
