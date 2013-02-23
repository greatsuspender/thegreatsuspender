/*global window, document, chrome, console, Image, gsStorage */

(function () {

    "use strict";

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
        img.src = url || chrome.extension.getURL("default.ico");
    }

    function getHashVariable(key) {

        var parts,
            temp,
            i;

        if (window.location.hash.length === 0) {
            return false;
        }

        parts = window.location.hash.substring(1).split("&");
        for (i = 0; i < parts.length; i++) {
            temp = parts[i].split("=");
            if (temp[0] === key) {
                return decodeURIComponent(temp[1]);
            }
        }
        return false;
    }

    function sendUnsuspendMessage(tabUrl) {

        chrome.extension.sendMessage({ action: "setUnsuspendedState", tabUrl: tabUrl }, function (response) {});
    }

    function unsuspendTab() {

        var url = getHashVariable('url');
        sendUnsuspendMessage(url);

        //try using tab history to go back
        if (window.history.length > 1) {
            window.history.back();

        //otherwise try to get url from hashtag
        } else if (url) {
            chrome.tabs.getCurrent(function (tab) {
                chrome.tabs.update(tab.id, {url: url});
            });

        //finally, show gs history instead (as all else has failed)
        } else {
            chrome.tabs.getCurrent(function (tab) {
                chrome.tabs.update(tab.id, {url: chrome.extension.getURL("history.html")});
            });
        }
    }

    function suspendTab(tab, tabProperties) {

        var faviconUrl,
            rootUrlStr = tabProperties.url,
            showPreview = gsStorage.fetchPreviewOption();

        //get root of url
        rootUrlStr = rootUrlStr.substring(rootUrlStr.indexOf("//") + 2);
        rootUrlStr = rootUrlStr.substring(0, rootUrlStr.indexOf("/"));

        document.onclick = unsuspendTab;

        document.getElementById("gsTitle").innerText = tabProperties.title;
        document.getElementById("gsTopBarImg").setAttribute('src', tabProperties.favicon);
        document.getElementById("gsTopBarTitle").innerText = tabProperties.title;
        document.getElementById("gsTopBarUrl").innerText = tabProperties.url.length > 100 ? tabProperties.url.substring(0, 100) + "..." : tabProperties.url;
        document.getElementById("gsTopBarInfo").innerText = "Tab suspended: click to reload OR ";
        document.getElementById("gsWhitelistLink").innerText = "add " + rootUrlStr + " to whitelist";
        document.getElementById("gsWhitelistLink").setAttribute('data-text', rootUrlStr);

        window.location.replace(chrome.extension.getURL("suspended.html")
                + "#url=" + encodeURIComponent(tabProperties.url));

        if (showPreview) {

            gsStorage.fetchPreviewImage(tabProperties.url, function (previewUrl) {
                if (previewUrl !== null) {
                    document.getElementById("gsPreview").setAttribute('src', previewUrl);
                }
            });
        }

        generateFaviconUri(tabProperties.favicon, function (faviconUrl) {
            document.getElementById("gsFavicon").setAttribute('href', faviconUrl);
        });

        //make sure tab is marked as suspended (may not be if reloaded from chrome restore)
        tabProperties.state = 'suspended';

        //update window and index information (may have changed if chrome has been restarted)
        tabProperties.windowId = tab.windowId;
        tabProperties.index = tab.index;

        gsStorage.saveTabToHistory(tabProperties.url, tabProperties);
    }

    function attemptTabSuspend(tab) {

        var tabProperties = gsStorage.fetchTabFromHistory(getHashVariable('url'));

        //if we have some suspend information for this tab
        if (tabProperties) {
            console.log("about to suspend tabId: " + tab.id);
            suspendTab(tab, tabProperties);

        //otherwise if there is some history information then use it
        } else if (window.history.length > 1) {
            unsuspendTab();

        //else just reload from url
        } else {
            chrome.tabs.update(tab.id, {url: getHashVariable('url')});
        }
    }

    function unsuspendTabListener(request, sender, sendResponse) {
        if (request.action === "unsuspendTab") {
            unsuspendTab();
        }
    }

    window.onload = function () {

        //handler for unsuspend
        chrome.extension.onMessage.addListener(unsuspendTabListener);

        //handler for whitelist
        document.getElementById("gsWhitelistLink").onclick = function (e) {
            gsStorage.saveToWhitelist(e.target.getAttribute('data-text'));
        };

        //try to suspend tab
        chrome.tabs.getCurrent(attemptTabSuspend);
    };

    window.onbeforeunload = function () {

        chrome.tabs.getCurrent(function (tab) {
            sendUnsuspendMessage(getHashVariable('url'));
        });
    };

    window.addEventListener("keydown", function (event) {
        if (event.keyCode === 13 || event.keyCode === 32 || event.keyCode === 40 || event.keyCode === 116) {
            event.preventDefault();
            unsuspendTab();
        }
    });

}());