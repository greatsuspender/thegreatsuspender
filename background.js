/*global chrome, window, Image, console, gsStorage, setInterval */

var tgs = (function () {

    "use strict";

    var version = 4.74,
        gsTimes = [];

    function markTabUnsuspended(tabUrl) {

        var tabProperties = gsStorage.fetchTabFromHistory(tabUrl);

        //mark tab as unsuspended
        //console.log("marking tab as unsuspended: " + tabUrl);
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

        //console.log("attempting to suspend: " + tab.url);
        if (previewUrl) {
            gsStorage.setPreviewImage(tab.url, previewUrl);
        }

        tabProperties = {
            date: new Date(),
            title: tab.title,
            url: tab.url,
            state: 'suspended',
            favicon: "chrome://favicon/" + tab.url,
            pinned: tab.pinned,
            index: tab.index,
            windowId: tab.windowId
        };

        if (tab.incognito) {
            tabProperties.favicon = tab.favIconUrl;
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

    function suspendTab(tab) {

        //don't allow suspending of already suspended tabs
        if (tab.url.indexOf("chrome-extension:") >= 0 || tab.url.indexOf("chrome:") >= 0 || tab.url.indexOf("file:") >= 0) {
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
                chrome.tabs.update(tab.id, {url: gsStorage.generateSuspendedUrl(tab.url)});
            });

        } else {
            saveSuspendData(tab, false);
            chrome.tabs.update(tab.id, {url: gsStorage.generateSuspendedUrl(tab.url)});
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
                            //console.log("checking time for: " + tabs[i].url);
                            //console.log("time=" + (new Date() - gsTimes[tabs[i].id]));
                            if (new Date() - gsTimes[tabs[i].id] >  timeToSuspend * 1000 * 60) {
                                //console.log("tab expired: " + tabs[i].url);
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
    function checkForCrashedTabs() {

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
            ii,
            upgraded = false;


        oldGsHistory = gsStorage.fetchOldGsHistory();

        //check for very old history migration
        if (oldGsHistory !== null &&
                    (lastVersion === null || parseFloat(lastVersion) < version)) {

            //merge old gsHistory with new one
            gsHistory = gsStorage.fetchGsHistory();
            ii = oldGsHistory.length;
            for (i = 0; i < ii; i++) {
                gsHistory.push(oldGsHistory[i]);
            }
            gsStorage.setGsHistory(gsHistory);
            gsStorage.removeOldGsHistory();
        }

        //if they are installing for the first time
        if (lastVersion === null && gsStorage.fetchGsHistory().length === 0) {

            //show welcome screen
            chrome.tabs.create({url: chrome.extension.getURL("welcome.html")});
            gsStorage.setVersion(version);
            gsStorage.setGsHistory([]);
            upgraded = true;

        //otherwise if they are upgrading
        } else if (parseFloat(lastVersion) < version) {

            //show new update screen
            chrome.tabs.create({url: chrome.extension.getURL("update.html")});
            gsStorage.setVersion(version);
            upgraded = true;
        }

        return upgraded;
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
                markTabUnsuspended(request.tabUrl);
            }
        }
    );

    //listen for tab create
    chrome.tabs.onCreated.addListener(function (tab) {
        gsTimes[tab.id] = new Date();
    });

    //listen for tab switching
    chrome.tabs.onSelectionChanged.addListener(function (tabId, info) {

        var unsuspend = gsStorage.fetchUnsuspendOnFocusOption();

        if (unsuspend && gsTimes[tabId] && (new Date() - gsTimes[tabId] > 3000)) {
            chrome.tabs.get(tabId, function (tab) {
                if (tab.url.indexOf("suspended.html") >= 0) {
                    chrome.tabs.sendMessage(tab.id, {action: "unsuspendTab"});
                }
            });

        } else if (gsTimes[tabId]) {
            gsTimes[tabId] = new Date();
        }

    });

    initialiseAllTabs();

    if (!checkForNewVersion()) {
        checkForCrashedTabs();
    }

    //start timer
    setInterval(function () {
        checkForTabsToAutoSuspend();
    }, 1000 * 60);

}());