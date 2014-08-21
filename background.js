/*
 * The Great Suspender
 * Copyright (C) 2014 Dean Oemcke
 * Available under GNU GENERAL PUBLIC LICENSE v2
 * http://github.com/deanoemcke/thegreatsuspender
 * ༼ つ ◕_◕ ༽つ
*/

var tgs = (function() {

    'use strict';

    var debug = false;
    var sessionId = Math.floor(Math.random() * 1000000);
    var sessionDate = new Date();
    var lastSelectedTabs = [];
    var currentTabId;

    function checkWhiteList(url) {

        var whitelist = gsUtils.getOption(gsUtils.WHITELIST),
            whitelistedWords = whitelist ? whitelist.split(/[\s\n]+/) : '',
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
        var gsHistory = gsUtils.fetchGsHistory(),
            tabProperties,
            rootUrl = gsUtils.getRootUrl(tab.url),
            favUrl;

        //console.log('attempting to suspend: ' + tab.url);
        if (previewUrl) {
            gsUtils.setPreviewImage(tab.url, previewUrl);
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
        gsUtils.setGsHistory(gsHistory);
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

        var dontSuspendPinned = gsUtils.getOption(gsUtils.IGNORE_PINNED);
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
                var rootUrlStr = gsUtils.getRootUrl(tabs[0].url);
                gsUtils.saveToWhitelist(rootUrlStr);
                requestTabUnsuspend(tabs[0].id);
            }
        });
    }

    function temporarilyWhitelistHighlightedTab(window) {

        chrome.tabs.query({windowId: window.id, highlighted: true}, function(tabs) {

            if (tabs.length > 0) {
                chrome.tabs.sendMessage(tabs[0].id, {action: 'tempWhitelist'});
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
/*
    function unsuspendAllTabs(curWindow) {

        var i,
            currentTab,
            tabProperties;

        for (i = 0; i < curWindow.tabs.length; i++) {

            currentTab = curWindow.tabs[i];

            //detect suspended tabs by looking for ones without content scripts
            if (!isSpecialTab(currentTab)) {

                (function() {
                    var tabId = currentTab.id;
                    //test if a content script is active by sending a 'requestInfo' message
                    chrome.tabs.sendMessage(tabId, {action: 'requestInfo'}, function(response) {

                        //if no response, then assume suspended
                        if (typeof(response) === 'undefined') {
                            requestTabUnsuspend(tabId);
                        }
                    });
                })();
            }
        }
    }
*/
    function unsuspendAllTabs(curWindow) {

        var i,
            currentTab,
            tabProperties,
            tabIds = [],
            tabResponses = {};

        for (i = 0; i < curWindow.tabs.length; i++) {

            currentTab = curWindow.tabs[i];

            //detect suspended tabs by looking for ones without content scripts
            if (!isSpecialTab(currentTab)) {

                tabIds.push(currentTab.id);

                (function() {
                    var tabId = currentTab.id;
                    checkForSuspendedTab(tabId, function(isSuspended) {

                        tabResponses[tabId] = true;
                        if (isSuspended) {
                            requestTabUnsuspend(tabId);
                        }
                    });
                })();
            }
        }

        //handle any other tabs that didn't respond for whatever reason (usually because the tab has crashed)
        setTimeout(function() {
            var i,
                curId;

            for (i = 0; i < tabIds.length; i++) {
                curId = tabIds[i];
                if (typeof(tabResponses[curId]) === 'undefined') {
                     requestTabUnsuspend(curId);
                }
            }
        }, 5000);
    }



    function checkForSuspendedTab(tabId, callback) {

        //test if a content script is active by sending a 'requestInfo' message
        chrome.tabs.sendMessage(tabId, {action: 'requestInfo'}, function(response) {

            //if response is given but is undefined, then assume suspended
            if (typeof(response) === 'undefined') {
                callback(true);
            } else {
                callback(false);
            }
        });
    }

    function saveWindowHistory() {

        chrome.windows.getAll({populate: true}, function(windows) {
            gsUtils.saveWindowsToSessionHistory(sessionId, windows);
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
        var timeout = gsUtils.getOption(gsUtils.SUSPEND_TIME) * 60 * 1000;
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

        //check internet connectivity
        } else if (!force && gsUtils.getOption(gsUtils.ONLINE_CHECK) && !navigator.onLine) {
            return;

        //if we need to save a preview image
        } else if (gsUtils.getOption(gsUtils.SHOW_PREVIEW)) {
            chrome.tabs.executeScript(tab.id, {file: 'html2canvas.min.js'}, function() {
                chrome.tabs.sendMessage(tab.id, {
                    action: 'generatePreview',
                    suspendedUrl: gsUtils.generateSuspendedUrl(tab.url)
                });
            });

        //else ask the tab to suspend itself
        } else {
            saveSuspendData(tab);
            chrome.tabs.sendMessage(tab.id, {
                action: 'confirmTabSuspend',
                suspendedUrl: gsUtils.generateSuspendedUrl(tab.url)
            });
        }
    }

    function requestTabUnsuspend(tabId) {
        /*chrome.tabs.sendMessage(tabId, {
            action: 'unsuspendTab'
        }, function(response) {
            if (!response) {
                chrome.tabs.reload(tabId);
            }
        });*/
        chrome.tabs.reload(tabId);
    }

    function unsuspendTab(tab) {
        chrome.tabs.reload(tab.id);
    }


    function suspendAllTabsOnStartup() {

        chrome.tabs.query({}, function(tabs) {

            var i,
                tab;
            for (i = 0; i < tabs.length; i++) {
                tab = tabs[i];
                if (!isSpecialTab(tab) && gsUtils.fetchTabFromHistory(tab.url)) {
                    requestTabSuspension(tab, true);
                }
            }
        });

        //should use declaritiveWebRequest here once it becomes stable
        /*chrome.webRequest.onBeforeRequest.addListener(
            function(details) {
                var args = '#url=' + encodeURIComponent(details.url);
                return {
                    redirectUrl: gsUtils.generateSuspendedUrl(chrome.extension.getURL('suspended.html' + args))
                };
            },
            {urls: ["<all_urls>"]},
            ["blocking"]
        );*/
    }

    //handler for message requests
    chrome.runtime.onMessage.addListener(
        function(request, sender, sendResponse) {

            if (debug) console.log('listener fired: ' + request.action);
            if (debug) console.dir(sender);

            //treat this as a handler for initial page load (called by content script on page load)
            if (request.action === 'prefs') {
                sendResponse({
                    dontSuspendForms: gsUtils.getOption(gsUtils.IGNORE_FORMS),
                    showPreview: gsUtils.getOption(gsUtils.SHOW_PREVIEW),
                    suspendTime: gsUtils.getOption(gsUtils.SUSPEND_TIME),
                    previewQuality: gsUtils.getOption(gsUtils.PREVIEW_QUALITY) ? 0.8 : 0.1
                });

            } else if (request.action === 'reportTabState') {
                updateIcon(request.status);

            } else if (request.action === 'confirmTabUnsuspend') {
                unsuspendTab(sender.tab);

            } else if (request.action === 'suspendTab') {
                requestTabSuspension(sender.tab);

            } else if (request.action === 'savePreviewData') {
                saveSuspendData(sender.tab, request.previewUrl);

            } else if (request.action === 'suspendOne') {
                chrome.windows.getLastFocused({populate: true}, suspendHighlightedTab);

            } else if (request.action === 'unsuspendOne') {
                chrome.windows.getLastFocused({populate: true}, unsuspendHighlightedTab);

            } else if (request.action === 'tempWhitelist') {
                chrome.windows.getLastFocused({populate: true}, temporarilyWhitelistHighlightedTab);

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
    chrome.tabs.onActivated.addListener(function(activeInfo) {

        if (debug) console.log('tab changed: ' + activeInfo.tabId);

        var lastSelectedTab = lastSelectedTabs[activeInfo.windowId];

        lastSelectedTabs[activeInfo.windowId] = activeInfo.tabId;
        currentTabId = activeInfo.tabId;

        //reset timer on tab that lost focus
        if (lastSelectedTab) {
            resetTabTimer(lastSelectedTab);
        }

        //update icon
        requestTabInfo(activeInfo.tabId, function(info) {
            updateIcon(info.status);
        });


        //pause for a bit before assuming we're on a new tab as some users
        //will key through intermediate tabs to get to the one they want.
        (function() {
            var selectedTab = activeInfo.tabId;
            setTimeout(function() {
                if (selectedTab === currentTabId) {
                    handleNewTabFocus(currentTabId);
                }
            }, 500);
        })();
    });

    function handleNewTabFocus(tabId) {

        var unsuspend = gsUtils.getOption(gsUtils.UNSUSPEND_ON_FOCUS);

        //if pref is set, then unsuspend newly focused tab
        if (unsuspend) {

            //get tab object so we can check if it is a special tab
            //if not, then we test if the tab is suspended by checking
            //for an active content script
            chrome.tabs.get(tabId, function(tab) {
                if (!isSpecialTab(tab)) {
                    checkForSuspendedTab(tabId, function(isSuspended) {
                        if (isSuspended) {
                            requestTabUnsuspend(tabId);
                        }
                    });
                }
            });
        }

        //clear timer on newly focused tab
        //NOTE: only works if tab is currently unsuspended
        cancelTabTimer(tabId);
    }


    //listen for tab updating
    //don't want to put a listener here as it's called too aggressively by chrome
    /*chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {

        if (debug) console.log('tab updated: ' + tabId);

        //if tab does not have focus, then set timer on newly created tab
        if (!tab.active) {
            resetTabTimer(tab.id);
        }
    });*/

    //suspendAllTabsOnStartup();

    if (debug) chrome.browserAction.setBadgeText({text: '!'});

    chrome.alarms.clearAll();
    chrome.alarms.create('saveWindowHistory', {periodInMinutes: 1});
    if (debug) console.log('alarm created: saveWindowHistory');

    chrome.alarms.onAlarm.addListener(function(alarm) {
        if (debug) console.log('alarm fired: ' + alarm.name);

        if (alarm.name === 'saveWindowHistory') {
            //chrome.browserAction.setBadgeText({text: "SAV"});
            console.log('saving current session. next save in 1 minute.');
            saveWindowHistory();
        }
    });

    chrome.runtime.onSuspend.addListener(function() {
        if (debug) console.log('unloading page.');
        if (debug) chrome.browserAction.setBadgeText({text: ''});
    });

    /*chrome.commands.onCommand.addListener(function(command) {
      chrome.tabs.create({url: "http://www.google.com/"});
    });*/

    chrome.runtime.onInstalled.addListener(function() {

        //show welcome screen
        chrome.tabs.create({url: chrome.extension.getURL('welcome.html')});

        var lastVersion = gsUtils.fetchVersion(),
            gsHistory = gsUtils.fetchGsHistory(),
            oldGsHistory = gsUtils.fetchOldGsHistory(),
            i;

        gsUtils.setVersion(chrome.runtime.getManifest().version);

        //check for very old history migration
        if (oldGsHistory !== null) {

            //merge old gsHistory with new one
            for (i = 0; i < oldGsHistory.length; i++) {
                gsHistory.push(oldGsHistory[i]);
            }
            gsUtils.setGsHistory(gsHistory);
            gsUtils.removeOldGsHistory();
        }

        //if they are installing for the first time
        if (!lastVersion) {
            gsUtils.setGsHistory([]);
        }

        //inject new content script into all open pages
        chrome.tabs.query({}, function(tabs) {
            var i,
                currentTab,
                timeout = gsUtils.getOption(gsUtils.SUSPEND_TIME) * 60 * 1000;

            for (i = 0; i < tabs.length; i++) {
                currentTab = tabs[i];

                if (!isSpecialTab(currentTab)) {

                    (function() {
                        var tabId = currentTab.id;
                        //test if a content script is active by sending a 'requestInfo' message
                        chrome.tabs.sendMessage(tabId, {action: 'requestInfo'}, function(response) {

                            //if no response, then try to dynamically load in the new contentscript.js file
                            if (typeof(response) === 'undefined') {
                                chrome.tabs.executeScript(tabId, {file: 'contentscript.js'}, function() {
                                    chrome.tabs.sendMessage(tabId, {action: 'resetTimer', timeout: timeout});
                                });
                            }
                        });
                    })();
                }
            }
        });

    });

    //get info for a tab. defaults to currentTab if no id passed in
    function requestTabInfo(tabId, callback) {

        tabId = tabId || currentTabId;

        chrome.tabs.get(tabId, function(tab) {
            getTabInfo(tab, function(info) {
                callback(info);
            });
        });
    }

    function getTabInfo(tab, callback) {

        var info = {
            tabId: tab.id,
            status: 'unknown',
            timerUp: 0
        };

        if (isSpecialTab(tab)) {
            info.status = 'special';
            callback(info);

        } else {

            chrome.tabs.sendMessage(tab.id, {action: 'requestInfo'}, function(response) {

                if (response) {
                    info.status = response.status;
                    info.timerUp = response.timerUp;
                    if (info.status === 'normal' && checkWhiteList(tab.url)) {
                        info.status = 'whitelisted';
                    } else if (info.status === 'normal' && isPinnedTab(tab)) {
                        info.status = 'pinned';
                    }

                //assume tab is suspended if there is no response
                } else {
                    info.status = 'suspended';
                }
                callback(info);
            });
        }
    }

    function checkTabStatus(reportedStatus) {
        
    }

    //change the icon to either active or inactive
    function updateIcon(status) {
        var icon = 'icon19.png',
            dontSuspendForms = gsUtils.getOption(gsUtils.IGNORE_FORMS),
            dontSuspendPinned = gsUtils.getOption(gsUtils.IGNORE_PINNED);

        if (status === 'suspended' || status === 'special') icon = 'icon19b.png';
        /*if (status === 'formInput' || status === 'special' || status === 'pinned'
                || status === 'tempWhitelist' || status === 'whitelisted') {
            icon = 'icon19b.png';
        }*/
        chrome.browserAction.setIcon({path: icon});

        if (status === 'formInput' && dontSuspendForms) {
            chrome.browserAction.setBadgeText({text: 'I'});

        } else if (status === 'pinned' && dontSuspendPinned) {
            chrome.browserAction.setBadgeText({text: 'P'});

        } else if (status === 'tempWhitelist') {
            chrome.browserAction.setBadgeText({text: 'TW'});

        } else if (status === 'whitelisted') {
            chrome.browserAction.setBadgeText({text: 'W'});

        } else {
            chrome.browserAction.setBadgeText({text: ''});
        }
    }

    return {
        requestTabInfo: requestTabInfo,
        updateIcon: updateIcon
    };

}());
