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
            currentTab,
            tabProperties;

        for (i = 0; i < curWindow.tabs.length; i++) {

            //detect suspended tabs by looking for ones without content scripts
            /*chrome.tabs.sendMessage(tabId, {
                action: 'requestInfo'
            }, function(response) {
                if (!response) {
                    chrome.tabs.reload(tabId);
                }
            });

            //unsuspend if tab has been suspended
            requestTabUnsuspend(curWindow.tabs[i].id);*/

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

    //handler for message requests
    chrome.runtime.onMessage.addListener(
        function(request, sender, sendResponse) {

            if (debug) console.log('listener fired: ' + request.action);
            if (debug) console.dir(sender);


            if (request.action === 'prefs') {
                sendResponse({
                    dontSuspendForms: gsUtils.getOption(gsUtils.IGNORE_FORMS),
                    showPreview: gsUtils.getOption(gsUtils.SHOW_PREVIEW),
                    suspendTime: gsUtils.getOption(gsUtils.SUSPEND_TIME),
                    previewQuality: gsUtils.getOption(gsUtils.PREVIEW_QUALITY) ? 0.8 : 0.1
                });

            } else if (request.action === 'confirmTabUnsuspend') {
                unsuspendTab(sender.tab);

            } else if (request.action === 'suspendTab') {
                requestTabSuspension(sender.tab);

            } else if (request.action === 'savePreviewData') {
                saveSuspendData(sender.tab, request.previewUrl);

            } else if (request.action === 'requestTabInfo' && request.tab) {

                getTabInfo(request.tab, function(info) {
                    chrome.runtime.sendMessage({action: 'confirmTabInfo', info: info});
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

        var unsuspend = gsUtils.getOption(gsUtils.UNSUSPEND_ON_FOCUS);
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

        if (debug) console.log('tab updated: ' + tabId);

        //if tab does not have focus, then set timer on newly created tab
        if (!tab.active) {
            resetTabTimer(tab.id);
        }
    });

    suspendAllTabsOnStartup();

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

}());
