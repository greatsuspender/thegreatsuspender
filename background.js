/*global chrome, window, Image, console, localStorage, setInterval */

var tgs = (function () {

    "use strict";

    var gsTimes = [];

    function getGsHistory() {

        var result = localStorage.getItem('gsHistory2');
        if (result === null) {
            result = [];
        } else {
            result = JSON.parse(result);
        }
        return result;
    }

    function checkWhiteList(url) {

        var whitelist = localStorage.getItem('gsWhitelist') || "",
            whitelistedWords = whitelist.split(" "),
            i;

        for (i = 0; i < whitelistedWords.length; i++) {
            if (whitelistedWords[i].length > 0 && url.indexOf(whitelistedWords[i]) >= 0) {
                return true;
            }
        }
        return false;
    }

    function saveSuspendData(tab) {

        var gsHistory = getGsHistory(),
            tabProperties;

        if (tab.incognito) {
            tabProperties = {id: tab.id, date: new Date(), title: tab.title, url: tab.url, favicon: tab.favIconUrl };
        } else {
            tabProperties = {id: tab.id, date: new Date(), title: tab.title, url: tab.url, favicon: "chrome://favicon/" + tab.url };
        }

        //add suspend information to start of history array
        gsHistory.unshift(tabProperties);

        //clean up old items
        while (gsHistory.length > 100) {
            gsHistory.pop();
        }
        localStorage.setItem('gsHistory2', JSON.stringify(gsHistory));
    }

    function suspendTab(tab) {

        //don't allow suspending of already suspended tabs
        if (tab.url.indexOf("chrome-extension") >= 0 || tab.url.indexOf("chrome:") >= 0) {
            return;
        }

        //check whitelist
        if (checkWhiteList(tab.url)) {
            return;
        }

        saveSuspendData(tab);
        chrome.tabs.update(tab.id, {url: chrome.extension.getURL("suspended.html")});
    }

    function suspendSpecificTab(tab) {
        if (!tab.active) {
            suspendTab(tab);

        //if tab is active then refresh timer for this tab
        } else {
            gsTimes[tab.id] = new Date();
        }
    }
    function suspendActiveTab(window) {
        var i;
        for (i = 0; i < window.tabs.length; i += 1) {
            if (window.tabs[i].active) {
                suspendTab(window.tabs[i]);
            }
        }
    }
    function suspendAllTabs(window) {
        var i;
        for (i = 0; i < window.tabs.length; i += 1) {
            if (window.tabs[i].url.indexOf("suspended.html") < 0) {
                suspendTab(window.tabs[i]);
            }
        }
    }
    function unsuspendAllTabs(curWindow) {
        var i;
        for (i = 0; i < curWindow.tabs.length; i += 1) {

            //unsuspend if tab has been suspended
            if (curWindow.tabs[i].url.indexOf("suspended.html") >= 0) {
                chrome.tabs.sendMessage(curWindow.tabs[i].id, {action: "unsuspendTab"});
            }

            //reset timers for all tabs in this window
            gsTimes[curWindow.tabs[i].id] = new Date();
        }
    }

    function checkForTabsToAutoSuspend() {

        var timeToSuspend = localStorage.getItem("gsTimeToSuspend") || 0;

        if (timeToSuspend > 0) {

            chrome.tabs.query({}, function (tabs) {

                var i;
                for (i in tabs) {
                    if (tabs.hasOwnProperty(i)) {
                        if (gsTimes[tabs[i].id]) {
                            if (new Date() - gsTimes[tabs[i].id] >  timeToSuspend * 1000 * 60) {
                                suspendSpecificTab(tabs[i]);
                            }
                        } else {
                            gsTimes[tabs[i].id] = new Date();
                        }
                    }
                }
            });
        }
    }

    //add an initial time to all open tabs
    function initialiseAllTabs() {

        chrome.tabs.query({}, function (tabs) {

            var i;
            for (i in tabs) {
                if (tabs.hasOwnProperty(i)) {
                    gsTimes[tabs[i].id] = new Date();
                }
            }
        });
    }


    //handler for popup clicks
    chrome.extension.onRequest.addListener(
        function (request, sender, sendResponse) {

            if (request.msg === "suspendOne") {
                chrome.windows.getLastFocused({populate: true}, suspendActiveTab);

            } else if (request.msg === "suspendAll") {
                chrome.windows.getLastFocused({populate: true}, suspendAllTabs);

            } else if (request.msg === "unsuspendAll") {
                chrome.windows.getLastFocused({populate: true}, unsuspendAllTabs);
            }
        }
    );

    //listen for tab switching
    chrome.tabs.onSelectionChanged.addListener(function (tabId, info) {
        if (gsTimes[tabId]) {
            gsTimes[tabId] = new Date();
        }
    });

    initialiseAllTabs();

    //start timer
    setInterval(function () {
        checkForTabsToAutoSuspend();
    }, 1000 * 60);

}());