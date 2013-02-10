/*global chrome, window, Image, console, gsStorage, setInterval */

var tgs = (function () {

    "use strict";

    var gsTimes = [];

    function markTabUnsuspended(tabUrl) {

        var tabProperties = gsStorage.fetchTabFromHistory(tabUrl);

        //mark tab as unsuspended
        tabProperties.state = 'unsuspended';
        gsStorage.saveTabToHistory(tabUrl, tabProperties);
    }

    function checkWhiteList(url) {

        var whitelist = gsStorage.fetchWhitelist(),
            whitelistedWords = whitelist.split(" "),
            i,
            ii = whitelistedWords.length;

        for (i = 0; i < ii; i++) {
            if (whitelistedWords[i].length > 0 && url.indexOf(whitelistedWords[i]) >= 0) {
                return true;
            }
        }
        return false;
    }

    function saveSuspendData(tab, previewUrl) {

        var gsHistory = gsStorage.fetchGsHistory(),
            tabProperties;

        if (previewUrl) {
            gsStorage.setPreviewImage(tab.url, previewUrl);
        }

        if (tab.incognito) {
            tabProperties = {date: new Date(), title: tab.title, url: tab.url, state: 'suspended', favicon: tab.favIconUrl };
        } else {
            tabProperties = {date: new Date(), title: tab.title, url: tab.url, state: 'suspended', favicon: "chrome://favicon/" + tab.url };
        }

        //add suspend information to start of history array
        gsHistory.unshift(tabProperties);

        //clean up old items
        while (gsHistory.length > 100) {
            gsHistory.pop();
        }
        gsStorage.setGsHistory(gsHistory);
    }

    function sendSuspendMessage(tab, callback) {

        chrome.tabs.executeScript(tab.id, {file: "html2canvas.min.js"}, function () {
            chrome.tabs.executeScript(tab.id, {file: "content_script.js"}, function () {

                chrome.tabs.sendMessage(tab.id, {}, function (response) {
                    var previewUrl = response ? response.previewUrl : '';
                    callback(tab, previewUrl);
                });
            });
        });
    }

    function generateSuspendedUrl(tabUrl) {
        return chrome.extension.getURL("suspended.html" + "#url=" + tabUrl);
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

        var preview = gsStorage.fetchPreviewOption();
        if (preview) {
            sendSuspendMessage(tab, function (tab, previewUrl) {
                saveSuspendData(tab, previewUrl);
                chrome.tabs.update(tab.id, {url: generateSuspendedUrl(tab.url)});
            });

        } else {
            saveSuspendData(tab, false);
            chrome.tabs.update(tab.id, {url: generateSuspendedUrl(tab.url)});
        }
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
        var i,
            ii = window.tabs.length;
        for (i = 0; i < ii; i += 1) {
            if (window.tabs[i].active) {
                suspendTab(window.tabs[i]);
            }
        }
    }
    function suspendAllTabs(window) {
        var i,
            ii = window.tabs.length;
        for (i = 0; i < ii; i += 1) {
            if (window.tabs[i].url.indexOf("suspended.html") < 0) {
                suspendTab(window.tabs[i]);
            }
        }
    }
    function unsuspendAllTabs(curWindow) {
        var i,
            ii = curWindow.tabs.length;
        for (i = 0; i < ii; i += 1) {

            //unsuspend if tab has been suspended
            if (curWindow.tabs[i].url.indexOf("suspended.html") >= 0) {
                chrome.tabs.sendMessage(curWindow.tabs[i].id, {action: "unsuspendTab"});
            }

            //reset timers for all tabs in this window
            gsTimes[curWindow.tabs[i].id] = new Date();
        }
    }

    function checkForTabsToAutoSuspend() {

        var timeToSuspend = gsStorage.fetchTimeToSuspendOption();

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

    //check for tabs that have a state of 'suspended'
    function restoreCrashedTabs() {

        chrome.tabs.query({}, function (tabs) {
            //first check to see if there are any suspended tabs already
            var i,
                ii,
                possibleCrash = false,
                openTabs = {},
                gsHistory;

            //if there is only one open tab then assume its a chrome restart (and don't restore)
            if (tabs.length < 2) {
                return;
            }

            for (i in tabs) {
                if (tabs.hasOwnProperty(i)) {
                    if (tabs[i].url.indexOf('suspended.html') >= 0) {
                        return;
                    } else {
                        openTabs[tabs[i].url] = true;
                    }
                }
            }

            gsHistory = gsStorage.fetchGsHistory();
            for (i in gsHistory) {
                if (gsHistory.hasOwnProperty(i)
                        && gsHistory[i].state === 'suspended'
                        && typeof (openTabs[gsHistory[i].url]) === 'undefined') {
                    possibleCrash = true;
                }
            }

            //if it's possible that we have crashed then show the recovery tab
            if (possibleCrash) {
                chrome.tabs.create({url: chrome.extension.getURL("recovery.html")});
            }
        });
    }

    function checkForNewVersion() {

        var lastVersion = gsStorage.fetchVersion(),
            gsHistory,
            oldGsHistory,
            i,
            ii;

        if (typeof (lastVersion) === 'undefined' || lastVersion !== '4.51') {

            //now we know they are on an old version but check to see if they are installing for the first time
            oldGsHistory = gsStorage.fetchOldGsHistory();

            //if they have gsHistory then they are upgrading
            if (oldGsHistory !== null) {

                //merge old gsHistory with new one
                gsHistory = gsStorage.fetchGsHistory();
                ii = oldGsHistory.length;
                for (i = 0; i < ii; i++) {
                    gsHistory.push(oldGsHistory[i]);
                }
                gsStorage.setGsHistory(gsHistory);
                gsStorage.removeOldGsHistory();

                chrome.tabs.create({url: chrome.extension.getURL("update.html")});
            }
            gsStorage.setVersion('4.51');
        }
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

    //handler for unsuspend
    chrome.extension.onMessage.addListener(
        function (request, sender, sendResponse) {
            if (request.action === "setUnsuspendedState") {
                console.log("marking tab as unsuspended: " + request.tabUrl);
                markTabUnsuspended(request.tabUrl);
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

    restoreCrashedTabs();

    checkForNewVersion();

    //start timer
    setInterval(function () {
        checkForTabsToAutoSuspend();
    }, 1000 * 60);

}());