
var tgs = (function() {

    'use strict';

    var debug = true;
    var sessionId = Math.floor(Math.random() * 1000000);
    var sessionDate = new Date();
    var lastSelectedTabs = [];

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

        //add suspend information to start of history array
        gsHistory.unshift(tabProperties);

        //clean up old items
        /*while (gsHistory.length > 100) {
            gsHistory.pop();
        }*/
        gsStorage.setGsHistory(gsHistory);
    }

    function isSpecialTab(tab) {

        if (tab.url.indexOf('chrome-extension:') == 0 ||
                tab.url.indexOf('chrome:') == 0 ||
                tab.url.indexOf('chrome-devtools:') == 0 ||
                tab.url.indexOf('file:') == 0 ||
                tab.url.indexOf('chrome.google.com/webstore') >= 0) {

            return true;
        } else {
            return false;
        }
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

        if (isPinnedTab(tab)) {
            return true;
        }
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
                requestTabSuspension(tabs[0], true);
            }
        });
    }

    function unsuspendHighlightedTab(window) {

        chrome.tabs.query({windowId: window.id, highlighted: true}, function(tabs) {

            if (tabs.length > 0) {
                requestTabUnsuspend(tabs[0].id);
            }
        });
    }

    function suspendAllTabs(window) {

        var i,
            curTab;

        for (i = 0; i < window.tabs.length; i++) {
            requestTabSuspension(window.tabs[i]);
        }
    }

    function unsuspendAllTabs(curWindow) {

        var i,
            curTab,
            tabProperties;

        for (i = 0; i < curWindow.tabs.length; i++) {

            //unsuspend if tab has been suspended
            requestTabUnsuspend(curWindow.tabs[i].id);
        }
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

    function resetTabTimer(tabId) {
        var timeout = gsStorage.fetchTimeToSuspendOption() * 60 * 1000;
        chrome.tabs.sendMessage(tabId, {action: 'resetTimer', timeout: timeout});
    }

    function cancelTabTimer(tabId) {
        chrome.tabs.sendMessage(tabId, {action: 'cancelTimer'});
    }

    function requestTabSuspension(tab, force) {

        force = force || false;

        //check whitelist
        if (!force && isExcluded(tab)) {
            return;

        //if we need to save a preview image
        } else if (gsStorage.fetchPreviewOption()) {
            chrome.tabs.executeScript(tab.id, {file: 'html2canvas.min.js'}, function() {
                chrome.tabs.sendMessage(tab.id, {
                    action: 'generatePreview',
                    suspendedUrl: gsStorage.generateSuspendedUrl(tab.url)
                });
            });

        //else ask the tab to suspend itself
        } else {
            saveSuspendData(tab);
            chrome.tabs.sendMessage(tab.id, {
                action: 'confirmTabSuspend',
                suspendedUrl: gsStorage.generateSuspendedUrl(tab.url)
            });
        }
    }

    function requestTabUnsuspend(tabId) {
        chrome.tabs.sendMessage(tabId, {
            action: 'unsuspendTab'
        });
    }

    function unsuspendTab(tab) {
        chrome.tabs.reload(tab.id);
    }

    function getTabStatus(tab, callback) {

        if (isSpecialTab(tab)) {
           callback('special');

        } else {

            chrome.tabs.sendMessage(tab.id, {action: 'requestStatus'}, function(response) {

                var status = response.status;

                if (status === 'normal' && checkWhiteList(tab.url)) {
                    status = 'whitelisted';
                } else if (status === 'normal' && isPinnedTab(tab)) {
                    status = 'pinned';
                }
                callback(status);
            });
        }
    }

    //handler for message requests
    chrome.runtime.onMessage.addListener(
        function(request, sender, sendResponse) {

            if (debug) console.log('listener fired: ' + request.action);
            if (debug) console.dir(sender);


            if (request.action === 'prefs') {
                sendResponse({
                    dontSuspendForms: gsStorage.fetchDontSuspendFormsOption(),
                    previewQuality: gsStorage.fetchPreviewQualityOption() ? 0.8 : 0.1
                });

            } else if (request.action === 'confirmTabUnsuspend') {
                unsuspendTab(sender.tab);

            } else if (request.action === 'suspendTab') {
                requestTabSuspension(sender.tab);

            } else if (request.action === 'savePreviewData') {

                if (request.previewUrl) {
                    saveSuspendData(sender.tab, request.previewUrl);
                }

            } else if (request.action === 'requestTabStatus' && request.tab) {

                getTabStatus(request.tab, function(status) {
                    chrome.runtime.sendMessage({action: 'confirmTabStatus', status: status});
                });

            } else if (request.action === 'suspendOne') {
                chrome.windows.getLastFocused({populate: true}, suspendHighlightedTab);

            } else if (request.action === 'unsuspendOne') {
                chrome.windows.getLastFocused({populate: true}, unsuspendHighlightedTab);

            } else if (request.action === 'whitelist') {
                chrome.windows.getLastFocused({populate: true}, whitelistHighlightedTab);

            } else if (request.action === 'suspendAll') {
                chrome.windows.getLastFocused({populate: true}, suspendAllTabs);

            } else if (request.action === 'unsuspendAll') {
                chrome.windows.getLastFocused({populate: true}, unsuspendAllTabs);
            }
        }
    );

    //listen for tab create
    /*chrome.tabs.onCreated.addListener(function(tab) {

        if (debug) console.log('tab created: ' + tab.url);
    });*/

    //listen for tab remove
    /*chrome.tabs.onRemoved.addListener(function(tabId, removeInfo) {

        if (debug) console.log('tab removed: ' + tabId);
    });*/

    //listen for tab switching
    chrome.tabs.onSelectionChanged.addListener(function(tabId, selectInfo) {

        if (debug) console.log('tab changed: ' + tabId);

        var unsuspend = gsStorage.fetchUnsuspendOnFocusOption();
        var lastSelectedTab = lastSelectedTabs[selectInfo.windowId];

        lastSelectedTabs[selectInfo.windowId] = tabId;

        //if pref is set, then unsuspend newly focused tab
        //NOTE: only works if tab is currently suspended
        if (unsuspend) {
            requestTabUnsuspend(tabId);
        }

        //clear timer on newly focused tab
        //NOTE: only works if tab is currently unsuspended
        cancelTabTimer(tabId);

        //reset timer on tab that lost focus
        if (lastSelectedTab) {
            resetTabTimer(lastSelectedTab);
        }

    });


    //listen for tab updating
    chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {

        //if tab does not have focus, then set timer on newly created tab
        if (!tab.active) {
            resetTabTimer(tab.id);
        }
    });

    //suspendAllTabsOnStartup();

    chrome.alarms.clearAll();
    chrome.alarms.create('saveWindowHistory', {periodInMinutes: 1});

    chrome.alarms.onAlarm.addListener(function(alarm) {
        console.log('alarm fired: ' + alarm.name);

        if (alarm.name === 'saveWindowHistory') {
            chrome.browserAction.setBadgeText({text: "SAV"});
            if (debug) console.log('saving current session. next save in 1 minute.');
            saveWindowHistory();
        }
    });


    chrome.runtime.onSuspend.addListener(function() {
        chrome.browserAction.setBadgeText({text: ""});
    });

    /*chrome.commands.onCommand.addListener(function(command) {
      chrome.tabs.create({url: "http://www.google.com/"});
    });*/

    chrome.runtime.onInstalled.addListener(function() {

        //show welcome screen
        chrome.tabs.create({url: chrome.extension.getURL('welcome.html')});

        var lastVersion = gsStorage.fetchVersion(),
            gsHistory = gsStorage.fetchGsHistory(),
            oldGsHistory = gsStorage.fetchOldGsHistory(),
            i;

        gsStorage.setVersion(chrome.runtime.getManifest().version);

        //check for very old history migration
        if (oldGsHistory !== null) {

            //merge old gsHistory with new one
            for (i = 0; i < oldGsHistory.length; i++) {
                gsHistory.push(oldGsHistory[i]);
            }
            gsStorage.setGsHistory(gsHistory);
            gsStorage.removeOldGsHistory();
        }

        //if they are installing for the first time
        if (!lastVersion) {
            gsStorage.setGsHistory([]);
        }

        //inject new content script into all open pages
        chrome.windows.getAll({populate: true}, function (windows) {
            var i = 0, w = windows.length, currentWindow;
            for( ; i < w; i++ ) {
                currentWindow = windows[i];
                var j = 0, t = currentWindow.tabs.length, currentTab;
                for( ; j < t; j++ ) {
                    currentTab = currentWindow.tabs[j];

                    if(!isSpecialTab(currentTab)) {
                        chrome.tabs.executeScript(currentTab.id, {
                            file: 'contentscript.js'
                        });
                    }
                }
            }
        });

    });

}());
