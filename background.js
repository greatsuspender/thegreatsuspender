
var tgs = (function() {

    'use strict';

    var STATE_REQUESTED = 'requested',
        STATE_INPROGRESS = 'inProgress',
        STATE_CONFIRMED = 'confirmed',
        STATE_SUSPENDED = 'suspended',
        STATE_UNSUSPENDED = 'unsuspended';

    var gsTimes = [];
    var debug = true;
    var sessionId = Math.floor(Math.random() * 1000000);
    var tempWhitelist = [];
    var suspendedList = {};
    var suspendedTabs = {};
    var publicFunctions = {};
    var lastSelectedTabs = [];

    function generateTabKey(tabId, windowId) {
        return tabId + '_' + windowId;
    }

    function tabsBeingSuspendedCount() {

        var key,
            count = 0;
        for (key in suspendedList) {
            if (suspendedList.hasOwnProperty(key) &&
                   suspendedList[key] === STATE_INPROGRESS) {
                count++;
            }
        }
        return count;
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

    function saveSuspendData(tab, previewUrl, callback) {
        var gsHistory = gsStorage.fetchGsHistory(),
            tabProperties,
            rootUrl = gsStorage.getRootUrl(tab.url),
            favUrl;

        //console.log('attempting to suspend: ' + tab.url);
        if (previewUrl) {
            gsStorage.setPreviewImage(tab.url, previewUrl);
        }

        if (tab.incognito) {
            favUrl = tab.favIconUrl;
        } else {
            favUrl = 'chrome://favicon/' + tab.url;
        }

        tabProperties = {
            date: new Date(),
            title: tab.title,
            url: tab.url,
            favicon: favUrl,
            pinned: tab.pinned,
            index: tab.index,
            windowId: tab.windowId
        };

        /*gsStorage.fetchFavicon(rootUrl, function(result) {
            if (result === null) {
                generateFaviconUri(favUrl, function(transparentFavUrl) {
                    gsStorage.setFavicon(rootUrl, transparentFavUrl);
                });
            }
        });*/

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
        return suspendedList[tabKey] === STATE_SUSPENDED || suspendedList[tabKey] === STATE_CONFIRMED;
    }

    function isSuspensionInProgress(tab) {
        var tabKey = generateTabKey(tab.id, tab.windowId);
        return suspendedList[tabKey] === STATE_INPROGRESS;
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

    function setTabState(tabId, windowId, state) {
        var tabKey = generateTabKey(tabId, windowId);
        suspendedList[tabKey] = state;
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
                "chrome.runtime.sendMessage({action: 'markAlreadySuspended'}); " +
            "}";

        chrome.tabs.executeScript(tab.id, {code: jsCode}, function() {});
    };

    function confirmSuspension(tab, useCachedPreviews) {

        useCachedPreviews = useCachedPreviews || false;
        setTabState(tab.id, tab.windowId, STATE_INPROGRESS);

        if (useCachedPreviews) {
            console.log('updating tab to suspended.html: ' + tab.url);
            chrome.tabs.update(tab.id, {url: gsStorage.generateSuspendedUrl(tab.url)});

        } else if (gsStorage.fetchPreviewOption()) {
            sendPreviewRequest(tab, function(tab, previewUrl) {
                saveSuspendData(tab, previewUrl);
                console.log('updating tab to suspended.html: ' + tab.url);
                chrome.tabs.update(tab.id, {url: gsStorage.generateSuspendedUrl(tab.url)});
            });

        } else {
            saveSuspendData(tab, false);
            console.log('updating tab to suspended.html: ' + tab.url);
            chrome.tabs.update(tab.id, {url: gsStorage.generateSuspendedUrl(tab.url)});
        }
    }


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
                var rootUrlStr = gsStorage.getRootUrl(tabs[0].url);
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

        var onlineCheck = gsStorage.fetchOnlineCheckOption();

        if (onlineCheck && !navigator.onLine) {
            return;
        }

        chrome.tabs.query({}, function(tabs) {

            var i,
                diff,
                curDate = new Date(),
                curTab,
                timeToSuspend = gsStorage.fetchTimeToSuspendOption() * 60 * 1000;

            for (i = 0; i < tabs.length; i++) {

                curTab = tabs[i];

                if (timeToSuspend > 0) {

                    if (isSuspensionInProgress(curTab)) {
console.log(curTab.id + ': tab suspension already in progress...');
                    }
                    if (isSuspended(curTab) || isSuspensionInProgress(curTab) || isExcluded(curTab) || !gsTimes[curTab.id]) {
                        gsTimes[curTab.id] = curDate;
                        continue;
                    }

                    diff = curDate - gsTimes[curTab.id];
                    if (diff > timeToSuspend) {
                        suspendTab(curTab);
                    }
                }
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
var tabKey = generateTabKey(tabs[i].id, tabs[i].windowId);
suspendedTabs[tabKey] = tabs[i];
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

            gsStorage.setGsHistory([]);
            gsStorage.setVersion(version);
            upgraded = true;

            //make sure they are not in an incognito window
            chrome.windows.getLastFocused({populate: true}, function(window) {
                if (!window.incognito) {

                    //show welcome screen
                    chrome.tabs.create({url: chrome.extension.getURL('welcome.html')});
                }
            });

        //otherwise if they are upgrading
        } else if (parseFloat(lastVersion) < version) {
            gsStorage.setVersion(version);
            upgraded = true;

            //make sure they are not in an incognito window
            chrome.windows.getLastFocused({populate: true}, function(window) {
                if (!window.incognito) {

                    //show update screen
                    chrome.tabs.create({url: chrome.extension.getURL('update.html')});
                }
            });
        }

        return upgraded;
    }

    //handler for message requests
    chrome.runtime.onMessage.addListener(
        function(request, sender, sendResponse) {

            if (debug) console.log('listener fired: ' + request.action);
            if (debug) console.dir(sender);

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

            } else if (request.action === 'markAlreadySuspended') {
                setTabState(sender.tab.id, sender.tab.windowId, STATE_CONFIRMED);

            } else if (request.action === 'setSuspendedState') {
                setTabState(sender.tab.id, sender.tab.windowId, STATE_SUSPENDED);

            } else if (request.action === 'setUnsuspendedState') {
                setTabState(sender.tab.id, sender.tab.windowId, STATE_UNSUSPENDED);

            } else if (request.action === 'confirmSuspension') {

                setTabState(sender.tab.id, sender.tab.windowId, STATE_REQUESTED);
                if (tabsBeingSuspendedCount() >= 2) {
console.log(sender.tab.id + ': 2 tabs already being suspended. waiting...');
                    var intervalJob = setInterval(function() {
                        if (tabsBeingSuspendedCount() < 2) {
console.log(sender.tab.id + ': ready to suspend tab now finally...');
                            clearInterval(intervalJob);
                            confirmSuspension(sender.tab);
                        } else {
                        }
                    }, 200);
                } else {
console.log(sender.tab.id + ': ready to suspend tab now...');
                    confirmSuspension(sender.tab);
                }

            } else if (request.action === 'confirmUnsuspension') {
                var bypassCache = gsStorage.fetchIgnoreCacheOption(),
                    jsCode = 'if (window.history.length > 1) { ' +
                                'window.history.back(); ' +
                            '} else { ' +
                                'window.location.reload(); ' +
                            '}';
                setTabState(sender.tab.id, sender.tab.windowId, STATE_UNSUSPENDED);
                //chrome.tabs.reload(sender.tab.id, {bypassCache: bypassCache});
                chrome.tabs.executeScript(sender.tab.id, {code: jsCode}, function() {});
            }
        }
    );

    //listen for tab create
    chrome.tabs.onCreated.addListener(function(tab) {

        if (debug) console.log('tab created: ' + tab.url);

        if (gsStorage.fetchTabFromHistory(tab.url)) {
            if (!isExcluded(tab)) {
                confirmSuspension(tab, true);
            }
        }

        gsTimes[tab.id] = new Date();
    });

    //listen for tab remove
    chrome.tabs.onRemoved.addListener(function(tabId, removeInfo) {

        if (debug) console.log('tab removed: ' + tabId);
        setTabState(tabId, removeInfo.windowId, STATE_UNSUSPENDED);
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

        if (changeInfo.status === 'complete') {

            if (debug) console.log('tab update ' + changeInfo.status + ': ' + tabId);

            //if we have not yet confirmed the suspension (happens when the suspended page calls history.replace)
            var tabKey = generateTabKey(tab.id, tab.windowId);
            //if (suspendedList[tabKey] && !suspendedList[tabKey] === STATE_CONFIRMED) {
            if (suspendedList[tabKey] === STATE_SUSPENDED) {

                if (debug) console.log('confirming tab suspension:' + tab.url);
                setTabState(tab.id, tab.windowId, STATE_CONFIRMED);

            //assume at this point that it is a subsequent page refresh (treat as an unsuspend if already suspended)
            } else {

                setTabState(tabId, tab.windowId, STATE_UNSUSPENDED);

                //if we are on a suspended page try to capture synched suspended tabs from other installation of the great suspender
                if (tab.url.indexOf('suspended.html#') > 0) {

                    //if the extension directory does not match this instance of the great suspender
                    if (tab.url.substring(tab.url, tab.url.indexOf('suspended.html')) !== chrome.extension.getURL('')) {

                        var hash = tab.url.substring(tab.url.indexOf('#'), tab.url.length),
                            url = gsStorage.getHashVariable('url', hash);

                        //convert url to this instance of the great suspender
                        chrome.tabs.update(tab.id, {url: gsStorage.generateSuspendedUrl(url)});
                    }
                } else {

                    //clear any possible tempWhitelist entry for this tab
                    var index = tempWhitelist.indexOf(tabId);
                    if (index > -1) {
                        console.log('clearing tab ' + tabId + ' from tempWhitelist');
                        tempWhitelist.splice(index, 1);
                    }
                }

            }

        }
    });

    initialiseAllTabs();
    checkForNewVersion();

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
    publicFunctions.isSuspensionInProgress = isSuspensionInProgress;
    publicFunctions.sessionId = sessionId;
    publicFunctions.suspendedList = suspendedList;
    publicFunctions.suspendedTabs = suspendedTabs;
    return publicFunctions;

}());
