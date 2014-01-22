
var tgs = (function() {

    'use strict';

    var version = "5.0.1";
    var gsTimes = [];
    var debug = false;
    var sessionId = Math.floor(Math.random() * 1000000);
    var tempWhitelist = [];

    function markTabUnsuspended(tabUrl) {

        var tabProperties = gsStorage.fetchTabFromHistory(tabUrl);

        //mark tab as unsuspended
        //console.log('marking tab as unsuspended: ' + tabUrl);
        tabProperties.state = 'unsuspended';
        gsStorage.saveTabToHistory(tabUrl, tabProperties);
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
            state: 'suspended',
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

    function sendSuspendMessage(tab, callback) {

        chrome.tabs.executeScript(tab.id, {file: 'html2canvas.min.js'}, function() {
            chrome.tabs.executeScript(tab.id, {file: 'previewscript.js'}, function() {

                var quality = gsStorage.fetchPreviewQualityOption() ? 0.8 : 0.1;

                chrome.tabs.sendMessage(tab.id, {quality: quality}, function(response) {
                    var previewUrl = response ? response.previewUrl : '';
                    callback(tab, previewUrl);
                });
            });
        });
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

    function isExcluded(tab) {

        var dontSuspendPinned = gsStorage.fetchDontSuspendPinnedOption();

        if (tab.active) {
            return true;
        }

        //don't suspend already suspended tabs
        if (tab.url.indexOf('suspended.html') > 0) {
            return true;
        }

        //don't allow suspending of already suspended tabs
        if (isSpecialTab(tab)) {
            return true;
        }

        //check whitelist
        if (checkWhiteList(tab.url)) {
            return true;
        }

        //check tempWhitelist (for form inputs)
        if (tempWhitelist.indexOf(tab.id) >= 0) {
            return true;
        }

        if (dontSuspendPinned && tabs[i].pinned) {
            return true;
        }
    }

    function suspendTab(tab) {

        var date = new Date();
        //console.log('suspendTab, tabid: ' + tab.id + ', url: ' + tab.url + ', date: ' + date);
        //console.trace();

        var preview = gsStorage.fetchPreviewOption(),
            url = gsStorage.generateSuspendedUrl(tab.url);

        if (preview) {
            sendSuspendMessage(tab, function(tab, previewUrl) {
                saveSuspendData(tab, previewUrl);
                //chrome.tabs.update(tab.id, {url: gsStorage.generateSuspendedUrl(tab.url)});
                chrome.tabs.executeScript(tab.id, {code: 'window.location.replace("' + url + '")', runAt: 'document_start'});
            });

        } else {
            saveSuspendData(tab, false);
            //chrome.tabs.update(tab.id, {url: gsStorage.generateSuspendedUrl(tab.url)});
            chrome.tabs.executeScript(tab.id, {code: 'window.location.replace("' + url + '")', runAt: 'document_start'});
        }
    }

    function suspendHighlightedTab(window) {

        chrome.tabs.query({windowId: window.id, highlighted: true}, function(tabs) {

            var i,
                curTab;

            for (i = 0; i < tabs.length; i++) {
                curTab = tabs[i];
                if (curTab.url.indexOf('suspended.html') < 0) {
                    suspendTab(curTab);
                }
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
            curTab;

        for (i = 0; i < curWindow.tabs.length; i++) {
            curTab = curWindow.tabs[i];

            //unsuspend if tab has been suspended
            if (curTab.url.indexOf('suspended.html') >= 0) {
                chrome.tabs.sendMessage(curTab.id, {action: 'unsuspendTab'});
            }

            //reset timers for all tabs in this window
            gsTimes[curTab.id] = new Date();
        }
    }

    function checkForTabsToAutoSuspend() {

        chrome.tabs.query({}, function(tabs) {

            var i,
                diff,
                curDate = new Date(),
                curTab,
                timeToSuspend = gsStorage.fetchTimeToSuspendOption();

            timeToSuspend = timeToSuspend * 60 * 1000;

            // console.log('checkForTabsToAutoSuspend, date: ' + date + ', dontSuspendPinned: ' + dontSuspendPinned);
            for (i = 0; i < tabs.length; i++) {

                curTab = tabs[i];

                if (timeToSuspend > 0) {

                    if (isExcluded(curTab) || !gsTimes[curTab.id]) {
                        gsTimes[curTab.id] = curDate;
                        continue;
                    }

                    diff = curDate - gsTimes[curTab.id];
                    //console.log('checking time for: ' + tabs[i].url + ', tabid: ' + tabs[i].id + ', date: ' + date + ', diff: ' + diff);
                    if (diff > timeToSuspend) {
                        //console.log('tab expired: ' + tabs[i].url + ', diff: ' + diff + ' > ' + maxTime);
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
                if (tabs[i].url.indexOf('suspended.html') >= 0) {
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

        var lastVersion = gsStorage.fetchVersion(),
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

    //handler for popup clicks
    chrome.extension.onRequest.addListener(
        function(request, sender, sendResponse) {

            if (request.msg === 'suspendOne') {
                chrome.windows.getLastFocused({populate: true}, suspendHighlightedTab);

            } else if (request.msg === 'suspendAll') {
                chrome.windows.getLastFocused({populate: true}, suspendAllTabs);

            } else if (request.msg === 'unsuspendAll') {
                chrome.windows.getLastFocused({populate: true}, unsuspendAllTabs);
            }
        }
    );

    //handler for unsuspend
    chrome.extension.onMessage.addListener(
        function(request, sender, sendResponse) {

            if (request.action === 'setUnsuspendedState') {
                markTabUnsuspended(request.tabUrl);

            } else if (request.action === 'setFormInputState') {
                if (gsStorage.fetchDontSuspendFormsOption()) {
                    tempWhitelist.push(sender.tab.id);
                    console.log('adding tab ' + sender.tab.id + ' to tempWhitelist');
                }
            }
        }
    );

    //listen for tab create
    chrome.tabs.onCreated.addListener(function(tab) {
        // console.log('onCreated, tab: ' + tab)
        gsTimes[tab.id] = new Date();
    });

    //listen for tab switching
    chrome.tabs.onSelectionChanged.addListener(function(tabId, info) {
        // console.log('onSelectionChanged tabId: ' + tabId + ', gsTimes: ' + gsTimes.toString());
        var unsuspend = gsStorage.fetchUnsuspendOnFocusOption();
        var date = new Date();
        var prevDate = gsTimes[tabId];
        var diff = date - prevDate;

        gsTimes[tabId] = date;

        if (unsuspend && prevDate && (diff > 3000)) {
            chrome.tabs.get(tabId, function(tab) {
                if (tab.url.indexOf('suspended.html') >= 0) {
                    // console.log("Going to send unsuspend msg, tabId " + tab.id);
                    chrome.tabs.sendMessage(tab.id, {action: 'unsuspendTab'});
                    gsTimes[tab.id] = new Date(); //reset timer after automatic unsuspend
                }
            });
        }
    });

    //listen for tab updating
    chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {

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
    });


    initialiseAllTabs();

    if (!checkForNewVersion()) {
        checkForCrashedTabs();
    }

    var timeToSuspend = gsStorage.fetchTimeToSuspendOption(),
        timer = Math.min(timeToSuspend * 60, 60) * 1000;

    //start timer for suspension checking
    setInterval(function() {
        console.log('checking for tabs to suspend. next check in ' + (timer / 1000) + ' seconds.');
        checkForTabsToAutoSuspend();
    }, timer);

    //start timer for saving windowHistory
    setInterval(function() {
        console.log('saving current session. next save in 60 seconds.');
        saveWindowHistory();
    }, 60 * 1000);

}());
