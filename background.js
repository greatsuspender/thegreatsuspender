/*global chrome, window, Image */

(function () {

    "use strict";

    var temporaryStorage = [];

    function killTab(tab, previewUrl, faviconUrl) {

        //store the tab details temporarily
        temporaryStorage["tab_" + tab.id] = {
            title: tab.title,
            favicon: faviconUrl,
            url: tab.url,
            preview: previewUrl
        };

        //kill the current tab
        var count = 0,
            testLoaded = function () {
                chrome.tabs.get(tab.id, function (killTab) {
                    //console.log('tab.id: '+ tab.id +' :: '+killTab.status);
                    if (killTab.status === 'complete') {
                        //update page to suspended.html
                        chrome.tabs.update(tab.id, {url: chrome.extension.getURL("suspended.html")});

                    } else {
                        count++;
                        //only try for 50 * 0.1 seconds
                        if (count < 50) {
                            window.setTimeout(testLoaded, 100);
                        }
                    }
                });
            };

        chrome.tabs.update(tab.id, {url: "chrome://kill"});
        testLoaded();
    }

    function generateFaviconUri(url, callback) {

        var img = new Image();
        img.onload = function () {
            var canvas,
                context;
            canvas = window.document.createElement("canvas");
            canvas.width = img.width;
            canvas.height = img.height;
            context = canvas.getContext("2d");
            context.globalAlpha = 0.5;
            context.drawImage(img, 0, 0);
            callback(canvas.toDataURL());
        };
        //console.log(url);
        img.src = url || chrome.extension.getURL("default.ico");

    }

    function sendSuspendMessage(tab, preview) {

        chrome.tabs.executeScript(tab.id, {file: "content_script.js"}, function () {

            var maxHeight = window.localStorage.getItem("maxHeight") || 2,
                format = window.localStorage.getItem("format") || 'image/png',
                quality = window.localStorage.getItem("quality") || 0.4,
                faviconUrl,
                previewUrl,
                previewGenerated = false,
                faviconGenerated = false;

            //a little hack here to send two asynchronous requests and only handle the second response to come back
            chrome.tabs.sendMessage(tab.id, {preview: preview, maxHeight: maxHeight, format: format, quality: quality}, function (response) {
                previewUrl = response ? response.previewUrl : '';
                previewGenerated = true;
                if (faviconGenerated !== false) { killTab(tab, previewUrl, faviconUrl); }
            });

            generateFaviconUri("chrome://favicon/" + tab.url, function (response) {
                faviconUrl = response;
                faviconGenerated = true;
                if (previewGenerated !== false) { killTab(tab, previewUrl, faviconUrl); }
            });
        });
    }

    function suspendTab(tab) {

        var preview = window.localStorage.getItem("preview") === "false" ? false : true;

        if (preview) {
            chrome.tabs.executeScript(tab.id, {file: "html2canvas.min.js"}, function () {
                sendSuspendMessage(tab, preview);
            });
        } else {
            sendSuspendMessage(tab, preview);
        }

    }

    function suspendOne() {

        chrome.windows.getLastFocused({populate: true}, function (window) {
            var i;
            for (i = 0; i < window.tabs.length; i += 1) {
                if (window.tabs[i].active) {
                    suspendTab(window.tabs[i]);
                }
            }
        });
    }
    function suspendAll() {

        chrome.windows.getLastFocused({populate: true}, function (window) {
            var i;
            for (i = 0; i < window.tabs.length; i += 1) {
                if (window.tabs[i].url.indexOf("suspended.html") < 0 &&  window.tabs[i].url.indexOf("chrome://kill") < 0) {
                    //console.log("tab.id"+window.tabs[i].id + " :: " +window.tabs[i].url);
                    suspendTab(window.tabs[i]);
                }
            }
        });
    }
    function performResponseCheck(tab) {
        console.log('checking reponse of: '+tab.id);
        if (tab.status !== 'loading') {
            var reload = window.setTimeout(function () { chrome.tabs.reload(tab.id); }, 300);
            chrome.tabs.executeScript(tab.id, {code: ""}, function (response) {
                window.clearTimeout(reload);
            });
        }
    }
    function unsuspendAll() {

        chrome.windows.getLastFocused({populate: true}, function (window) {

            var i;
            for (i = 0; i < window.tabs.length; i += 1) {

                //unsuspend if tab has been suspended
                if (window.tabs[i].url.indexOf("suspended.html") >= 0) {
                    chrome.tabs.update(window.tabs[i].id, {url: window.tabs[i].url});

                //or if tab is set to chrome://kill page
                } else if (window.tabs[i].url.indexOf("chrome://kill") >= 0) {
                    chrome.tabs.reload(window.tabs[i].id);

                //otherwise test for an unreponsive page (happens when page has been killed accidentally)
                } else {
                    performResponseCheck(window.tabs[i]);
                }
            }
        });
    }

    //handler for popup clicks
    chrome.extension.onRequest.addListener(
        function (request, sender, sendResponse) {

            if (request.msg === "suspendOne") {
                suspendOne();

            } else if (request.msg === "suspendAll") {
                suspendAll();

            } else if (request.msg === "unsuspendAll") {
                unsuspendAll();
            }
        }
    );

    //handler for tab update
    chrome.tabs.onUpdated.addListener(function() {

    });        

    //handler for suspended.html onload
    chrome.extension.onMessage.addListener(
        function (request, sender, sendResponse) {
            if (request.action === "initialise") {

                var tabProperties = temporaryStorage["tab_" + sender.tab.id];

                //if we have a some suspend information for this tab
                if (typeof tabProperties !== 'undefined') {

                    sendResponse({
                        backtrack: "false",
                        title: tabProperties.title,
                        favicon: tabProperties.favicon,
                        url: tabProperties.url,
                        preview: tabProperties.preview
                    });

                    //remove this entry (so that a refresh will cause original content to be loaded)
                    delete temporaryStorage["tab_" + sender.tab.id];

                //otherwise force tab to reload original content
                } else {
                    sendResponse({
                        backtrack: "true"
                    });

                }
            }
        }
    );


}());