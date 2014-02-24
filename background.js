
var tgs = (function() {

    'use strict';

    var gsTimes = [];
    var debug = true;
    var sessionId = Math.floor(Math.random() * 1000000);
    var tempWhitelist = [];
    var suspendedList = {};
    var publicFunctions = {};
    var lastSelectedTabs = [];

    function generateTabKey(tabId, windowId) {
        return tabId + '_' + windowId;
    }

    function checkWhiteList(url) {

        var whitelist = gsStorage.fetchWhitelist(),
            whitelistedWords = whitelist.split(/[\s\n]+/),
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

        //console.log('attempting to suspend: ' + tab.url);
        if (previewUrl) {
            gsStorage.setPreviewImage(tab.url, previewUrl);
        }

        tabProperties = {
            date: new Date(),
            title: tab.title,
            url: tab.url,
            favicon: 'chrome://favicon/' + tab.url,
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

    function isSpecialTab(tab) {
        if (tab.url.indexOf('chrome-extension:') == 0 ||
                tab.url.indexOf('chrome:') == 0 ||
                tab.url.indexOf('chrome-devtools:') == 0 ||
                tab.url.indexOf('file:') == 0) {
            return true;
        } else {
            return false;
        }
    }

    function isSuspended(tab) {
        var tabKey = generateTabKey(tab.id, tab.windowId);
        return suspendedList[tabKey];
    }

    function isTempWhitelisted(tab) {
        return tempWhitelist.indexOf(tab.id) >= 0;
    }

    function isPinnedTab(tab) {

        var dontSuspendPinned = gsStorage.fetchDontSuspendPinnedOption();
        return dontSuspendPinned && tab.pinned;
    }

    function isExcluded(tab) {

        if (tab.active) {
            return true;
        }

        //don't allow suspending of special tabs
        if (isSpecialTab(tab)) {
            return true;
        }

        //check whitelist
        if (checkWhiteList(tab.url)) {
            return true;
        }

        //check tempWhitelist (for form inputs)
        if (isTempWhitelisted(tab)) {
            return true;
        }

        if (isPinnedTab(tab)) {
            return true;
        }
    }

    function markTabSuspended(tabId, windowId) {
        var tabKey = generateTabKey(tabId, windowId);
        suspendedList[tabKey] = true;
    }

    function markTabUnsuspended(tabId, windowId) {
        var tabKey = generateTabKey(tabId, windowId);
        suspendedList[tabKey] = false;
    }

    function setFormInputState(tab) {

        if (gsStorage.fetchDontSuspendFormsOption()) {
            tempWhitelist.push(tab.id);
            console.log('adding tab ' + tab.id + ' to tempWhitelist');
        }
    }

    function unsuspendTab(tab) {

        var jsCode =
            "if (document.getElementById('gsTopBar')) { " +
                "console.log('sending unsuspension confirm');" +
                "chrome.runtime.sendMessage({action: 'confirmUnsuspension'}); " +
            "}" +
            "else { " +
                "console.log('already unsuspended');" +
                "chrome.runtime.sendMessage({action: 'setUnsuspendedState'}); " +
            "}";

        chrome.tabs.executeScript(tab.id, {code: jsCode}, function() {});
        gsTimes[tab.id] = new Date();
    }

    function suspendTab(tab) {

        var jsCode =
            "if (!document.getElementById('gsTopBar')) { " +
                "console.log('sending suspension confirm');" +
                "chrome.runtime.sendMessage({action: 'confirmSuspension'}); " +
            "}" +
            "else { " +
                "console.log('already suspended');" +
                "chrome.runtime.sendMessage({action: 'setSuspendedState'}); " +
            "}";

        chrome.tabs.executeScript(tab.id, {code: jsCode}, function() {});
    };


    function sendPreviewRequest(tab, callback) {

        chrome.tabs.executeScript(tab.id, {file: 'html2canvas.min.js'}, function() {
            chrome.tabs.executeScript(tab.id, {file: 'previewscript.js'}, function() {

                var quality = gsStorage.fetchPreviewQualityOption() ? 0.8 : 0.1;

                if (debug) console.log('sending new message: suspendTabWithPreview');

                chrome.tabs.sendMessage(tab.id, {action: 'suspendTabWithPreview', quality: quality}, function(response) {
                    var previewUrl = response ? response.previewUrl : '';
                    callback(tab, previewUrl);
                });
            });
        });
    }

    function whitelistHighlightedTab(window) {

        chrome.tabs.query({windowId: window.id, highlighted: true}, function(tabs) {

            if (tabs.length > 0) {
                var rootUrlStr = tabs[0].url,
                    rootUrlStr = rootUrlStr.indexOf('//') > 0 ? rootUrlStr.substring(rootUrlStr.indexOf('//') + 2) : rootUrlStr;
                    rootUrlStr = rootUrlStr.substring(0, rootUrlStr.indexOf('/'));
                gsStorage.saveToWhitelist(rootUrlStr);
            }
        });
    }

    function suspendHighlightedTab(window) {

        chrome.tabs.query({windowId: window.id, highlighted: true}, function(tabs) {

            if (tabs.length > 0) {
                suspendTab(tabs[0]);
            }
        });
    }

    function unsuspendHighlightedTab(window) {

        chrome.tabs.query({windowId: window.id, highlighted: true}, function(tabs) {

            if (tabs.length > 0) {
                unsuspendTab(tabs[0]);
            }
        });
    }

    function suspendAllTabs(window) {

        var i,
            curTab;

        for (i = 0; i < window.tabs.length; i++) {
            curTab = window.tabs[i];
            if (!isExcluded(curTab)) {
                suspendTab(curTab);
            }
        }
    }

    function unsuspendAllTabs(curWindow) {

        var i,
            curTab,
            tabProperties;

        for (i = 0; i < curWindow.tabs.length; i++) {
            curTab = curWindow.tabs[i];

            //unsuspend if tab has been suspended
            unsuspendTab(curTab);
        }
    }

    function checkForTabsToAutoSuspend() {

        chrome.tabs.query({}, function(tabs) {

            var i,
                diff,
                curDate = new Date(),
                curTab,
                timeToSuspend = gsStorage.fetchTimeToSuspendOption() * 60 * 1000,
                tabsToSuspend = [];

            for (i = 0; i < tabs.length; i++) {

                curTab = tabs[i];

                if (timeToSuspend > 0) {

                    if (isSuspended(curTab) || isExcluded(curTab) || !gsTimes[curTab.id]) {
                        gsTimes[curTab.id] = curDate;
                        continue;
                    }

                    diff = curDate - gsTimes[curTab.id];
                    if (diff > timeToSuspend) {
                        tabsToSuspend.push(curTab);
                    }
                }
            }

            //stagger suspends in 100ms intervals
            if (tabsToSuspend.length > 0) {

                var i = 0,
                    intervalLength = 300,
                    intervalJob = setInterval(function() {
                    suspendTab(tabsToSuspend[i]);
                    i++;

                    //clear interval is we have reached the end of the list or if the time taken exceeds the poll length
                    if (i >= tabsToSuspend.length) {
                        clearInterval(intervalJob);
                    }
                }, intervalLength);
            }
        });
    }

    function saveWindowHistory() {

        chrome.windows.getAll({populate: true}, function(windows) {
            gsStorage.saveWindowsToSessionHistory(sessionId, windows);
        });
    }

    //add an initial time to all open tabs
    function initialiseAllTabs() {

        chrome.tabs.query({}, function(tabs) {

            var i;
            for (i = 0; i < tabs.length; i++) {
                gsTimes[tabs[i].id] = new Date();
            }
        });
    }

    //check for tabs that have a state of 'suspended'
    function checkForCrashedTabs() {

        chrome.tabs.query({}, function(tabs) {
            //first check to see if there are any suspended tabs already
            var i,
                possibleCrash = false,
                openTabs = {},
                gsHistory;

            //if there is only one open tab then assume its a chrome restart (and don't restore)
            if (tabs.length < 2) {
                return;
            }

            for (i = 0; i < tabs.length; i++) {
                if (isSuspended(tabs[i])) {
                    return;

                } else {
                    openTabs[tabs[i].url] = true;
                }
            }

            gsHistory = gsStorage.fetchGsHistory();
            for (i = 0; i < gsHistory.length; i++) {
                if (gsHistory[i].state === 'suspended' && typeof (openTabs[gsHistory[i].url]) === 'undefined') {
                    possibleCrash = true;
                }
            }

            //if it's possible that we have crashed then show the recovery tab
            if (possibleCrash) {
                chrome.tabs.create({url: chrome.extension.getURL('recovery.html')});
            }
        });
    }

    function checkForNewVersion() {

        var version = chrome.runtime.getManifest().version,
            lastVersion = gsStorage.fetchVersion(),
            gsHistory,
            oldGsHistory,
            i,
            upgraded = false;


        oldGsHistory = gsStorage.fetchOldGsHistory();

        //check for very old history migration
        if (oldGsHistory !== null &&
                    (lastVersion === null || parseFloat(lastVersion) < version)) {

            //merge old gsHistory with new one
            gsHistory = gsStorage.fetchGsHistory();
            for (i = 0; i < oldGsHistory.length; i++) {
                gsHistory.push(oldGsHistory[i]);
            }
            gsStorage.setGsHistory(gsHistory);
            gsStorage.removeOldGsHistory();
        }

        //if they are installing for the first time
        if (lastVersion === null && gsStorage.fetchGsHistory().length === 0) {

            //make sure they are not in an incognito window
            chrome.windows.getLastFocused({populate: true}, function(window) {
                if (!window.incognito) {

                    //show welcome screen
                    chrome.tabs.create({url: chrome.extension.getURL('welcome.html')});
                    gsStorage.setVersion(version);
                    gsStorage.setGsHistory([]);
                    upgraded = true;
                }
            });

        //otherwise if they are upgrading
        } else if (parseFloat(lastVersion) < version) {

            //show new update screen
            chrome.tabs.create({url: chrome.extension.getURL('update.html')});
            gsStorage.setVersion(version);
            upgraded = true;
        }

        return upgraded;
    }

    //handler for message requests
    chrome.runtime.onMessage.addListener(
        function(request, sender, sendResponse) {

            if (debug) console.dir('listener fired: ' + request.action);

            if (request.action === 'suspendOne') {
                chrome.windows.getLastFocused({populate: true}, suspendHighlightedTab);

            } else if (request.action === 'unsuspendOne') {
                chrome.windows.getLastFocused({populate: true}, unsuspendHighlightedTab);

            } else if (request.action === 'whitelist') {
                chrome.windows.getLastFocused({populate: true}, whitelistHighlightedTab);

            } else if (request.action === 'suspendAll') {
                chrome.windows.getLastFocused({populate: true}, suspendAllTabs);

            } else if (request.action === 'unsuspendAll') {
                chrome.windows.getLastFocused({populate: true}, unsuspendAllTabs);

            } else if (request.action === 'setFormInputState') {
                setFormInputState(sender.tab);

            } else if (request.action === 'setSuspendedState') {
                markTabSuspended(sender.tab.id, sender.tab.windowId);

            } else if (request.action === 'setUnsuspendedState') {
                markTabUnsuspended(sender.tab.id, sender.tab.windowId);

            } else if (request.action === 'confirmSuspension') {

                if (gsStorage.fetchPreviewOption()) {
                    sendPreviewRequest(sender.tab, function(tab, previewUrl) {
                        saveSuspendData(tab, previewUrl);
                        console.log('updating tab to suspended.html: ' + tab.url);
                        chrome.tabs.update(tab.id, {url: gsStorage.generateSuspendedUrl(tab.url)});
                    });
                } else {
                    saveSuspendData(sender.tab, false);
                    console.log('updating tab to suspended.html: ' + sender.tab.url);
                    chrome.tabs.update(sender.tab.id, {url: gsStorage.generateSuspendedUrl(sender.tab.url)});
                }

            } else if (request.action === 'confirmUnsuspension') {
                var bypassCache = gsStorage.fetchIgnoreCacheOption();
                markTabUnsuspended(sender.tab.id, sender.tab.windowId);
                //chrome.tabs.reload(sender.tab.id, {bypassCache: bypassCache});
                chrome.tabs.executeScript(sender.tab.id, {code: "window.history.back()"}, function() {});
            }
        }
    );

    //listen for tab create
    chrome.tabs.onCreated.addListener(function(tab) {

        if (debug) console.log('tab created: ' + tab.url);
        gsTimes[tab.id] = new Date();
    });

    //listen for tab remove
    chrome.tabs.onRemoved.addListener(function(tabId, removeInfo) {

        if (debug) console.log('tab removed: ' + tabId);
        markTabUnsuspended(tabId, removeInfo.windowId);
    });

    //listen for tab switching
    chrome.tabs.onSelectionChanged.addListener(function(tabId, selectInfo) {

        if (debug) console.log('tab changed: ' + tabId);

        var unsuspend = gsStorage.fetchUnsuspendOnFocusOption();
        var date = new Date();
        var prevDate = gsTimes[tabId];
        var diff = date - prevDate;
        var lastSelectedTab = lastSelectedTabs[selectInfo.windowId];

        gsTimes[tabId] = date;
        if (typeof (lastSelectedTab) != 'undefined') {
            gsTimes[lastSelectedTab] = date;
        }
        lastSelectedTabs[selectInfo.windowId] = tabId;

        if (unsuspend && prevDate && (diff > 3000)) {
            chrome.tabs.get(tabId, function(tab) {
                unsuspendTab(tab);
            });
        }
    });


    //listen for tab updating
    chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {

        if (debug) console.log('tab updated: ' + tabId);

        markTabUnsuspended(tabId, tab.windowId);

        //if we are on a suspended page try to capture synched suspended tabs from other installation of the great suspender
        if (tab.url.indexOf('suspended.html#') > 0) {

            //if the extension directory does not match this instance of the great suspender
            /*if (tab.url.substring(tab.url, tab.url.indexOf('suspended.html')) !== chrome.extension.getURL('')) {

                var hash = tab.url.substring(tab.url.indexOf('#'), tab.url.length),
                    url = gsStorage.getHashVariable('url', hash);

                //convert url to this instance of the great suspender
                chrome.tabs.update(tab.id, {url: gsStorage.generateSuspendedUrl(url)});
            }*/
        } else {

            //clear any possible tempWhitelist entry for this tab
            var index = tempWhitelist.indexOf(tabId);
            if (index > -1) {
                console.log('clearing tab ' + tabId + ' from tempWhitelist');
                tempWhitelist.splice(index, 1);
            }
        }
    });

    initialiseAllTabs();

    if (!checkForNewVersion()) {
        checkForCrashedTabs();
    }

    //start timer for suspension checking
    var timeToSuspend = gsStorage.fetchTimeToSuspendOption() * 60 * 1000,
        pollTimer = 60 * 1000;

    if (timeToSuspend > 0 && timeToSuspend < pollTimer) {
        pollTimer = timeToSuspend;
    }

    setInterval(function() {
        if (debug) {
            console.log('checking for tabs to suspend. next check in ' + (pollTimer / 1000) + ' seconds.');
            console.log('suspendedList: ');
            console.dir(suspendedList);
        }
        checkForTabsToAutoSuspend();
    }, pollTimer);

    //start timer for saving windowHistory
    setInterval(function() {
        if (debug) console.log('saving current session. next save in 60 seconds.');
        saveWindowHistory();
    }, 60 * 1000);

    publicFunctions.checkWhiteList = checkWhiteList;
    publicFunctions.isTempWhitelisted = isTempWhitelisted;
    publicFunctions.isSpecialTab = isSpecialTab;
    publicFunctions.isPinnedTab = isPinnedTab;
    publicFunctions.isSuspended = isSuspended;
    return publicFunctions;

}());
