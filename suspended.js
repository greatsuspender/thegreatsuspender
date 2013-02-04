/*global window, document, chrome, console, localStorage, Image */

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
                return temp[1];
            }
        }
        return false;
    }

    function fetchTabFromHistory(tabId) {

        var gsHistory = JSON.parse(localStorage.getItem('gsHistory2')),
            i;

        for (i = 0; i < gsHistory.length; i++) {
            if (gsHistory[i].id === parseInt(tabId, 10)) {
                return gsHistory[i];
            }
        }
        return false;
    }

    function getPropertiesForTab(tabId) {

        var tabProperties = fetchTabFromHistory(tabId);

        //if no properties found try getting id from hashtag and use that
        if (!tabProperties && getHashVariable('id')) {
            tabProperties = fetchTabFromHistory(getHashVariable('id'));
        }
        return tabProperties;
    }

    function unsuspendTab() {

        //try using tab history to go back
        if (window.history.length > 1) {
            window.history.back();

        //otherwise try to get url from hashtag
        } else if (getHashVariable('url')) {
            window.location.replace(getHashVariable('url'));

        //finally, show gs history instead (as all else has failed)
        } else {
            window.location.replace(chrome.extension.getURL("history.html"));
        }
    }

    function suspendTab(tabProperties) {

        var faviconUrl,
            rootUrlStr = tabProperties.url;

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
                + "#id=" + tabProperties.id
                + "&url=" + tabProperties.url);

        generateFaviconUri(tabProperties.favicon, function (faviconUrl) {
            document.getElementById("gsFavicon").setAttribute('href', faviconUrl);
        });

    }

    function attemptTabSuspend(tab) {

        var tabProperties = getPropertiesForTab(tab.id);

        //if we have some suspend information for this tab
        if (tabProperties) {
            console.log("about to suspend tabId: " + tab.id);
            suspendTab(tabProperties);

        //otherwise if there is some history information then use it
        } else if (window.history.length > 1) {
            unsuspendTab();
        }
    }

    function unsuspendTabListener(request, sender, sendResponse) {
        if (request.action === "unsuspendTab") {
            unsuspendTab();
        }
    }

    function addToWhitelist() {
        var whitelist = localStorage.getItem("gsWhitelist") || "",
            text = document.getElementById("gsWhitelistLink").getAttribute('data-text'),
            gsHistory = JSON.parse(localStorage.getItem('gsHistory2')),
            i;

        localStorage.setItem("gsWhitelist", whitelist + " " + text);
    }

    window.onload = function () {

        //handler for unsuspend
        chrome.extension.onMessage.addListener(unsuspendTabListener);

        //handler for whitelist
        document.getElementById("gsWhitelistLink").onclick = addToWhitelist;

        //try to suspend tab
        chrome.tabs.getCurrent(attemptTabSuspend);
    };

}());