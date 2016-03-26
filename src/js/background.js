/*global gsUtils, gsTimes, chrome */
/*
 * The Great Suspender
 * Copyright (C) 2015 Dean Oemcke
 * Available under GNU GENERAL PUBLIC LICENSE v2
 * http://github.com/deanoemcke/thegreatsuspender
 * ༼ つ ◕_◕ ༽つ
*/


var _gaq = _gaq || [];

var tgs = (function () {
    'use strict';

    var debug = false,
        sessionId,
        lastSelectedTabs = [],
        globalCurrentTabId,
        sessionSaveTimer,
        chargingMode = false,
        lastStatus = 'normal',
        notice = {},
        contextMenuItems = false,
        unsuspendRequestList = {},
        audibleTabsList = {},
        lastTabCloseTimestamp = new Date(),
        suspensionActiveIcon = '/img/icon19.png',
        suspensionPausedIcon = '/img/icon19b.png';


    //set gloabl sessionId
    sessionId = gsUtils.generateSessionId();
    if (debug) console.log('sessionId: ' + sessionId);

    function savePreview(tab, previewUrl) {
        if (previewUrl) {
            gsUtils.addPreviewImage(tab.url, previewUrl);
        }
    }

    function saveSuspendData(tab, tabPropertyOverrides, callback) {

        var tabProperties,
            favUrl;

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

        Object.keys(tabPropertyOverrides).forEach(function (prop) {
            tabProperties[prop] = tabPropertyOverrides[prop];
        });

        //add suspend information to suspendedTabInfo
        gsUtils.addSuspendedTabInfo(tabProperties, function() {
            if (typeof(callback) === "function") callback();
        });
    }

    //tests for non-standard web pages. does not check for suspended pages!
    function isSpecialTab(tab) {
        var url = tab.url;

        if ((url.indexOf('chrome-extension:') === 0 && url.indexOf('suspended.html') < 0)
                || url.indexOf('chrome:') === 0
                || url.indexOf('chrome-devtools:') === 0
                || url.indexOf('file:') === 0
                || url.indexOf('chrome.google.com/webstore') >= 0) {
            return true;
        }
        return false;
    }

    function isPinnedTab(tab) {
        var dontSuspendPinned = gsUtils.getOption(gsUtils.IGNORE_PINNED);
        return dontSuspendPinned && tab.pinned;
    }

    function isAudibleTab(tab) {
        var dontSuspendAudible = gsUtils.getOption(gsUtils.IGNORE_AUDIO);
        return dontSuspendAudible && tab.audible;
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
        if (gsUtils.checkWhiteList(tab.url)) {
            return true;
        }

        if (isPinnedTab(tab)) {
            return true;
        }

        if (isAudibleTab(tab)) {
            return true;
        }
        return false;
    }

    function confirmTabSuspension(tab) {

        //ask the tab to suspend itself
        saveSuspendData(tab, {}, function() {

            //if we need to save a preview image
            if (gsUtils.getOption(gsUtils.SCREEN_CAPTURE) !== '0') {
                chrome.tabs.executeScript(tab.id, { file: 'js/html2canvas.min.js' }, function () {
                    sendMessageToTab(tab.id, {
                        action: 'generatePreview',
                        suspendedUrl: gsUtils.generateSuspendedUrl(tab),
                        screenCapture: gsUtils.getOption(gsUtils.SCREEN_CAPTURE)
                    });
                });

            } else {
                sendMessageToTab(tab.id, {
                    action: 'confirmTabSuspend',
                    suspendedUrl: gsUtils.generateSuspendedUrl(tab)
                });
            }
        });
    }

    function requestTabSuspension(tab, force) {
        force = force || false;

        //safety check
        if (typeof(tab) === 'undefined') return;

        //make sure tab is not special or already suspended
        if (isSuspended(tab) || isSpecialTab(tab)) return;

        //if forcing tab suspend then skip other checks
        if (force) {
            confirmTabSuspension(tab);

        //otherwise perform soft checks before suspending
        } else {

            //check whitelist
            if (isExcluded(tab)) {
                return;
            }
            //check internet connectivity
            if (gsUtils.getOption(gsUtils.ONLINE_CHECK) && !navigator.onLine) {
                return;
            }
            //check if computer is running on battery
            if (gsUtils.getOption(gsUtils.BATTERY_CHECK) && chargingMode) {
                return;

            } else {
                confirmTabSuspension(tab);
            }
        }
    }

    function whitelistHighlightedTab() {
        chrome.tabs.query({active: true, currentWindow: true}, function (tabs) {
            if (tabs.length > 0) {
                var rootUrlStr = gsUtils.getRootUrl(tabs[0].url);
                gsUtils.saveToWhitelist(rootUrlStr);
                if (isSuspended(tabs[0])) {
                    unsuspendTab(tabs[0]);
                }
            }
        });
    }

    function unwhitelistHighlightedTab() {
        chrome.tabs.query({active: true, currentWindow: true}, function (tabs) {
            if (tabs.length > 0) {
                gsUtils.removeFromWhitelist(tabs[0].url);
            }
        });
    }

    function temporarilyWhitelistHighlightedTab() {

        chrome.tabs.query({active: true, currentWindow: true}, function (tabs) {
            if (tabs.length > 0) {
                sendMessageToTab(tabs[0].id, {action: 'tempWhitelist'});
            }
        });
    }

    function undoTemporarilyWhitelistHighlightedTab() {
        chrome.tabs.query({active: true, currentWindow: true}, function (tabs) {
            if (tabs.length > 0) {
                sendMessageToTab(tabs[0].id, {action: 'undoTempWhitelist'});
            }
        });
    }

    function openLinkInSuspendedTab(parentTab, linkedUrl) {

        var googleParams = linkedUrl.match(/^https:\/\/www.google.[^\/]+.\/url\?(.*)/);

        //test if the linkedUrl is a google search result
        if (googleParams && googleParams.length === 2) {
            googleParams = googleParams[1].split('&');

            googleParams.forEach(function (param) {
                if (param.indexOf('url=') === 0) {
                    linkedUrl = decodeURIComponent(param.substring(4));
                }
            });
        }

        var fakeTabProperties = {
                url: linkedUrl,
                title: linkedUrl
            },
            suspendedUrl = gsUtils.generateSuspendedUrl(fakeTabProperties),
            index = parentTab.index + 1,
            tabPropertyOverrides = {
                url: linkedUrl,
                fakeTab: true,
                pinned: false,
                index: index
            };

        saveSuspendData(parentTab, tabPropertyOverrides, function() {
            chrome.tabs.create({ url: suspendedUrl, index: index, active: false });
        });
    }

    function suspendHighlightedTab() {
        chrome.tabs.query({active: true, currentWindow: true}, function (tabs) {
            if (tabs.length > 0) {
                requestTabSuspension(tabs[0], true);
            }
        });
    }

    function unsuspendHighlightedTab() {
        chrome.tabs.query({active: true, currentWindow: true}, function (tabs) {
            if (tabs.length > 0 && isSuspended(tabs[0])) {
                unsuspendTab(tabs[0]);
            }
        });
    }

    function suspendAllTabs() {
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            var curWindowId = tabs[0].windowId;
            chrome.windows.get(curWindowId, {populate: true}, function(curWindow) {
                curWindow.tabs.forEach(function (tab) {
                    if (!tab.active) {
                        requestTabSuspension(tab, true);
                    }
                });
            });
        });
    }


    function suspendAllTabsInAllWindows() {
        chrome.tabs.query({}, function (tabs) {
            tabs.forEach(function (currentTab) {
                requestTabSuspension(currentTab, true);
            });
        });
    }

    function isSuspended(tab) {
        return tab.url.indexOf('suspended.html') >= 0;
    }

    function unsuspendAllTabs() {
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            var curWindowId = tabs[0].windowId;
            chrome.windows.get(curWindowId, {populate: true}, function(curWindow) {
                curWindow.tabs.forEach(function (currentTab) {
                    if (isSuspended(currentTab)) {
                        unsuspendTab(currentTab);
                    }
                });
            });
        });
    }

    function unsuspendAllTabsInAllWindows() {
        chrome.tabs.query({}, function (tabs) {
            tabs.forEach(function (currentTab) {
                if (isSuspended(currentTab)) unsuspendTab(currentTab);
            });
        });
    }

    function suspendSelectedTabs() {
        chrome.tabs.query({highlighted: true, lastFocusedWindow: true}, function (selectedTabs) {
            selectedTabs.forEach(function (tab) {
                requestTabSuspension(tab, true);
            });
        });
    }

    function unsuspendSelectedTabs() {
        chrome.tabs.query({highlighted: true, lastFocusedWindow: true}, function (selectedTabs) {
            selectedTabs.forEach(function (tab) {
                if (isSuspended(tab)) {
                    unsuspendTab(tab);
                }
            });
        });
    }

    function resuspendAllSuspendedTabs() {
        chrome.tabs.query({}, function (tabs) {
            tabs.forEach(function (currentTab) {
                if (isSuspended(currentTab)) {
                    unsuspendRequestList[currentTab.id] = 'ignore';
                    chrome.tabs.reload(currentTab.id);
                }
            });
        });
    }

    function queueSessionTimer() {
        clearTimeout(sessionSaveTimer);
        sessionSaveTimer = setTimeout(function() {
            if (debug) {
                console.log('savingWindowHistory');
            }
            saveWindowHistory();
        }, 1000);
    }

    function saveWindowHistory() {
        chrome.windows.getAll({populate: true}, function (windows) {
            //uses global sessionId
            gsUtils.saveWindowsToSessionHistory(sessionId, windows);
        });
    }

    function resetAllTabTimers() {
        chrome.tabs.query({}, function (tabs) {
            tabs.forEach(function (currentTab) {
                resetTabTimer(currentTab.id);
            });
        });
    }

    function resetTabTimer(tabId) {
        var timeout = gsUtils.getOption(gsUtils.SUSPEND_TIME);
        sendMessageToTab(tabId, {action: 'resetTimer', suspendTime: timeout});
    }

    function cancelTabTimer(tabId) {
        sendMessageToTab(tabId, {action: 'cancelTimer'});
    }

    function unsuspendTab(tab) {
        var url = gsUtils.getSuspendedUrl(tab.url),
            views,
            result;

        //bit of a hack here as using the chrome.tabs.update method will not allow
        //me to 'replace' the url - leaving a suspended tab in the history
        views = chrome.extension.getViews({type: 'tab', "windowId": tab.windowId});
        result = views.some(function (view) {
            if (view.tabId === tab.id) {
                view.location.replace(url);
                return true;
            }
        });

        //if we failed to find the tab with the above method then try to update it directly
        if (!result) {
            chrome.tabs.update(tab.id, {url: url}, function() {
                if (chrome.runtime.lastError) {
                    console.log(chrome.runtime.lastError.message);
                }
            });
        }
    }

    function handleWindowFocusChanged(windowId) {

        if (debug) {
            console.log('window changed: ' + windowId);
        }

        chrome.tabs.query({active: true, windowId: windowId}, function(tabs) {
            if (tabs && tabs.length === 1) {

                lastSelectedTabs[windowId] = tabs[0].id;
                globalCurrentTabId = tabs[0].id;

                //update icon
                requestTabInfo(tabs[0].id, function (info) {
                    updateIcon(info.status);
                });
            }
        });
    }

    function handleTabFocusChanged(tabId, windowId) {

        if (debug) {
            console.log('tab changed: ' + tabId);
        }

        var lastSelectedTab = lastSelectedTabs[windowId];

        lastSelectedTabs[windowId] = tabId;
        globalCurrentTabId = tabId;

        //reset timer on tab that lost focus
        //TODO: ideally we'd only reset timer on last tab viewed for more than 500ms (as per setTimeout below)
        //but that's getting tricky to determine
        if (lastSelectedTab) {
            resetTabTimer(lastSelectedTab);
        }

        //update icon
        requestTabInfo(tabId, function (info) {
            updateIcon(info.status);
        });

        //check to see if we have just recently removed a tab
        //if so, assume this is an 'accidental' tab focus and do not unsuspend
        if (lastTabCloseTimestamp > (new Date()) - 500) {
            if (debug) console.log('ignoring tab focus');
            return;
        }

        //pause for a bit before assuming we're on a new tab as some users
        //will key through intermediate tabs to get to the one they want.
        (function () {
            var selectedTab = tabId;
            setTimeout(function () {
                if (selectedTab === globalCurrentTabId) {
                    handleNewTabFocus(globalCurrentTabId);
                }
            }, 500);
        }());
    }

    function handleNewTabFocus(tabId) {
        var unsuspend = gsUtils.getOption(gsUtils.UNSUSPEND_ON_FOCUS);

        //if pref is set, then unsuspend newly focused tab
        if (unsuspend) {
            //get tab object so we can check if it is a special or suspended tab
            chrome.tabs.get(tabId, function (tab) {
                if (!isSpecialTab(tab) && isSuspended(tab)) {
                    unsuspendTab(tab);
                }
            });
        }

        //clear timer on newly focused tab
        //NOTE: only works if tab is currently unsuspended
        cancelTabTimer(tabId);
    }

    function checkForCrashRecovery(forceRecovery) {

        //try to detect whether the extension has crashed as separate to chrome crashing
        //if it is just the extension that has crashed, then in theory all suspended tabs will be gone
        //and all normal tabs will still exist with the same ids

        var suspendedTabCount = 0,
            unsuspendedTabCount = 0,
            suspendedTabs = [],
            tabResponses = [],
            unsuspendedSessionTabs = [],
            currentlyOpenTabs = [],
            attemptRecovery = true;

        gsUtils.fetchLastSession().then(function (lastSession) {

            if (!lastSession) {
                return;
            }

            //collect all nonspecial, unsuspended tabs from the last session
            lastSession.windows.forEach(function (sessionWindow) {
                sessionWindow.tabs.forEach(function (sessionTab) {

                    if (!isSpecialTab(sessionTab)) {
                        if (!isSuspended(sessionTab)) {
                            unsuspendedSessionTabs.push(sessionTab);
                            unsuspendedTabCount++;
                        } else {
                            suspendedTabCount++;
                        }
                    }
                });
            });

            //don't attempt recovery if last session had no suspended tabs
            if (suspendedTabCount === 0) return;

            //check to see if they still exist in current session
            chrome.tabs.query({}, function (tabs) {

                //don't attempt recovery if there are less tabs in current session than there were
                //unsuspended tabs in the last session
                if (tabs.length < unsuspendedTabCount) return;

                //if there is only one currently open tab and it is the 'new tab' page then abort recovery
                if (tabs.length === 1 && tabs[0].url === "chrome://newtab/") return;

                tabs.forEach(function (curTab) {
                    currentlyOpenTabs[curTab.id] = curTab;

                    //test if a suspended tab has crashed by sending a 'requestInfo' message
                    if (!isSpecialTab(curTab) && isSuspended(curTab)) {
                        suspendedTabs.push(curTab);
                        sendMessageToTab(curTab.id, {action: 'requestInfo'}, function (response) {
                            tabResponses[curTab.id] = true;
                        });

                        //don't attempt recovery if there are still suspended tabs open
                        attemptRecovery = false;
                    }
                });

                unsuspendedSessionTabs.some(function (sessionTab) {
                    //if any of the tabIds from the session don't exist in the current session then abort recovery
                    if (typeof(currentlyOpenTabs[sessionTab.id]) === 'undefined') {
                        attemptRecovery = false;
                        return true;
                    }
                });

                if (attemptRecovery) {
                    if (forceRecovery) {
                        gsUtils.recoverLostTabs(null);
                    } else {
                        chrome.tabs.create({url: chrome.extension.getURL('recovery.html')});
                    }
                }

                //check for suspended tabs that haven't respond for whatever reason (usually because the tab has crashed)
                setTimeout(function () {
                    suspendedTabs.forEach(function (curTab) {
                        if (typeof(tabResponses[curTab.id]) === 'undefined') {

                            //automatically reload unresponsive suspended tabs
                            chrome.tabs.reload(curTab.id);
                        }
                    });
                }, 5000);
            });
        });
    }

    function reinjectContentScripts() {
        chrome.tabs.query({}, function (tabs) {
            var timeout = gsUtils.getOption(gsUtils.SUSPEND_TIME);

            tabs.forEach(function (currentTab) {
                if (!isSpecialTab(currentTab) && !isSuspended(currentTab)) {
                    var tabId = currentTab.id;

                    chrome.tabs.executeScript(tabId, {file: 'js/contentscript.js'}, function () {
                        if (chrome.runtime.lastError) {
                            if (debug) console.log(chrome.runtime.lastError.message);
                        } else {
                            sendMessageToTab(tabId, {action: 'resetTimer', suspendTime: timeout});
                        }
                    });
                }
            });
        });
    }

    function runStartupChecks() {

        var lastVersion = gsUtils.fetchLastVersion(),
            curVersion = chrome.runtime.getManifest().version,
            contextMenus = gsUtils.getOption(gsUtils.ADD_CONTEXT);

        //if version has changed then assume initial install or upgrade
        if (lastVersion !== curVersion) {
            gsUtils.setLastVersion(curVersion);

            //if they are installing for the first time
            if (!lastVersion) {

				// prevent welcome screen to opening every time we use incognito mode (due to localstorage not saved)
				if (!chrome.extension.inIncognitoContext) {
					//show welcome screen
					chrome.tabs.create({url: chrome.extension.getURL('welcome.html')});
				}

            //else if they are upgrading to a new version
            } else {

                //if upgrading from an old version
                if (lastVersion < 6.12) {

                    gsUtils.performOldMigration(lastVersion, function() {

                        //show update screen
                        chrome.tabs.create({url: chrome.extension.getURL('update.html')});
                    });

                //for users already upgraded to 6.12 just recover tabs silently in background
                } else {

                    gsUtils.performNewMigration(lastVersion);

                    //recover tabs silently
                    checkForCrashRecovery(true);

                    //show update screen
                    chrome.tabs.create({url: chrome.extension.getURL('update.html')});
                }

            }

        //else if restarting the same version
        } else {

            //check for possible crash
            checkForCrashRecovery(false);
        }

        //inject new content script into all open pages
        reinjectContentScripts();

        //trim excess dbItems
        if (lastVersion > 6.12) {
            gsUtils.trimDbItems();
        }

        //add context menu items
        buildContextMenu(contextMenus);
    }

    function checkForNotices() {

        var xhr = new XMLHttpRequest(),
            resp,
            lastNoticeVersion = gsUtils.fetchNoticeVersion();

        xhr.open("GET", "https://greatsuspender.github.io/notice.json", true);
        xhr.timeout = 4000;
        xhr.setRequestHeader('Cache-Control', 'no-cache');
        xhr.onreadystatechange = function() {
          if (xhr.readyState == 4 && xhr.responseText) {
            var resp = JSON.parse(xhr.responseText);

            //only show notice if it is intended for this version and it has not already been shown
            if (resp.active && resp.text && resp.title
                    && resp.target === chrome.runtime.getManifest().version
                    && resp.version !== lastNoticeVersion) {

                //set global notice field (so that notice page can access text)
                notice = resp;

                //update local notice version
                gsUtils.setNoticeVersion(resp.version);

                //show notice page
                chrome.tabs.create({url: chrome.extension.getURL('notice.html')});
            }
          }
        };
        xhr.send();
    }

    function requestNotice() {
        return notice;
    }

    //get info for a tab. defaults to currentTab if no id passed in
    //returns the current tab suspension and timer states. possible suspension states are:

    //normal: a tab that will be suspended
    //special: a tab that cannot be suspended
    //suspended: a tab that is suspended
    //never: suspension timer set to 'never suspend'
    //formInput: a tab that has a partially completed form (and IGNORE_FORMS is true)
    //audible: a tab that is playing audio (and IGNORE_AUDIO is true)
    //tempWhitelist: a tab that has been manually paused
    //pinned: a pinned tab (and IGNORE_PINNED is true)
    //whitelisted: a tab that has been whitelisted
    //charging: computer currently charging (and BATTERY_CHECK is true)
    //noConnectivity: internet currently offline (and ONLINE_CHECK is true)
    //unknown: an error detecting tab status
    function requestTabInfo(tabId, callback) {

        var info = {
                windowId: '',
                tabId: '',
                status: 'unknown',
                timerUp: '-'
            };
        tabId = tabId || globalCurrentTabId;

        if (typeof(tabId) === 'undefined') {
            callback(info);
            return;
        }

        chrome.tabs.get(tabId, function (tab) {

            if (chrome.runtime.lastError) {
                if (debug) console.log(chrome.runtime.lastError.message);
                callback(info);

            } else {

                info.windowId = tab.windowId;
                info.tabId = tab.id;

                //check if it is a special tab
                if (isSpecialTab(tab)) {
                    info.status = 'special';
                    callback(info);

                //check if it has already been suspended
                } else if (isSuspended(tab)) {
                    info.status = 'suspended';
                    callback(info);

                //request tab state and timer state from the content script
                } else {
                    requestTabInfoFromContentScript(tab, function(tabInfo) {
                        if (tabInfo) {
                            info.status = processActiveTabStatus(tab, tabInfo.status);
                            info.timerUp = tabInfo.timerUp;
                        }
                        callback(info);
                    });

                }
            }
        });
    }


    function requestTabInfoFromContentScript(tab, callback) {

        sendMessageToTab(tab.id, {action: 'requestInfo'}, function (response) {
            if (response) {
                var tabInfo = {};
                tabInfo.status = response.status;
                tabInfo.timerUp = response.timerUp;
                callback(tabInfo);
            } else {
                callback(false);
            }
        });
    }

    function processActiveTabStatus(tab, status) {

        var suspendTime = gsUtils.getOption(gsUtils.SUSPEND_TIME),
            onlySuspendOnBattery = gsUtils.getOption(gsUtils.BATTERY_CHECK),
            onlySuspendWithInternet = gsUtils.getOption(gsUtils.ONLINE_CHECK);

        //check whitelist
        if (gsUtils.checkWhiteList(tab.url)) {
            status = 'whitelisted';

        //check pinned tab
        } else if (status === 'normal' && isPinnedTab(tab)) {
            status = 'pinned';

        //check audible tab
        } else if (status === 'normal' && isAudibleTab(tab)) {
            status = 'audible';

        //check never suspend
        } else if (status === 'normal' && suspendTime === "0") {
            status = 'never';

        //check running on battery
        } else if (status === 'normal' && onlySuspendOnBattery && chargingMode) {
            status = 'charging';

        //check internet connectivity
        } else if (status === 'normal' && onlySuspendWithInternet && !navigator.onLine) {
            status = 'noConnectivity';
        }
        return status;
    }

    //change the icon to either active or inactive
    function updateIcon(status) {
        var icon = status !== 'normal' ? suspensionPausedIcon : suspensionActiveIcon;
        lastStatus = status;
        chrome.browserAction.setIcon({path: icon});
    }



    //HANDLERS FOR RIGHT-CLICK CONTEXT MENU

    function buildContextMenu(showContextMenu) {

        var currentDisplayLevel = contextMenuItems ? contextMenuItems.length : 0,
            allContexts = ["page", "frame", "selection", "editable", "image",
                "video", "audio", "browser_action", "page_action"
            ];

        chrome.contextMenus.removeAll();
        contextMenuItems = [];

        //Open tab suspended
        contextMenuItems.push(chrome.contextMenus.create({
            title: "Open link in new suspended tab",
            contexts:["link"],
            onclick: function (info, tab) {
                openLinkInSuspendedTab(tab, info.linkUrl);
            }
        }));

        if (showContextMenu) {

            //make right click Context Menu for Chrome
            contextMenuItems.push(chrome.contextMenus.create({
                type: "separator"
            }));

            //Suspend present tab
            contextMenuItems.push(chrome.contextMenus.create({
                title: "Suspend tab",
                contexts: allContexts,
                onclick: suspendHighlightedTab
            }));

            //Add present tab to temporary whitelist
            contextMenuItems.push(chrome.contextMenus.create({
                title: "Don't suspend for now",
                contexts: allContexts,
                onclick: temporarilyWhitelistHighlightedTab
            }));

            //Add present tab to permenant whitelist
            contextMenuItems.push(chrome.contextMenus.create({
                title: "Never suspend this site",
                contexts: allContexts,
                onclick: whitelistHighlightedTab
            }));

            //Suspend all the tabs
            contextMenuItems.push(chrome.contextMenus.create({
                title: "Suspend other tabs",
                contexts: allContexts,
                onclick: suspendAllTabs
            }));

            //Unsuspend all the tabs
            contextMenuItems.push(chrome.contextMenus.create({
                title: "Unsuspend all tabs",
                contexts: allContexts,
                onclick: unsuspendAllTabs
            }));

             //Open settings page
            contextMenuItems.push(chrome.contextMenus.create({
                title: "Settings",
                contexts: allContexts,
                onclick: function(e) {
                    chrome.tabs.create({
                        url: chrome.extension.getURL('options.html')
                    });
                }
            }));
        }
    }


    //HANDLERS FOR KEYBOARD SHORTCUTS

    chrome.commands.onCommand.addListener(function (command) {
        if (command === '1-suspend-tab') {
            suspendHighlightedTab();

        } else if (command === '2-unsuspend-tab') {
            unsuspendHighlightedTab();

        } else if (command === '3-suspend-active-window') {
            suspendAllTabs();

        } else if (command === '4-unsuspend-active-window') {
            unsuspendAllTabs();

        } else if (command === '5-suspend-all-windows') {
            suspendAllTabsInAllWindows();

        } else if (command === '6-unsuspend-all-windows') {
            unsuspendAllTabsInAllWindows();
        }
    });



    //HANDLERS FOR MESSAGE REQUESTS

    function sendMessageToTab(tabId, message, callback) {
        try {
            chrome.tabs.sendMessage(tabId, message, {frameId: 0}, callback);
        }
        catch(e) {
            chrome.tabs.sendMessage(tabId, message, callback);
        }
    }

    function messageRequestListener(request, sender, sendResponse) {
        if (debug) {
            console.log('listener fired:', request.action);
            console.dir(sender);
        }

        switch (request.action) {
        case 'prefs':
            sendResponse({
                dontSuspendForms: gsUtils.getOption(gsUtils.IGNORE_FORMS),
                suspendTime: gsUtils.getOption(gsUtils.SUSPEND_TIME),
                screenCapture: gsUtils.getOption(gsUtils.SCREEN_CAPTURE),
                tabId: sender.tab.id
            });
            break;

        case 'reportTabState':
            if (sender.tab && sender.tab.id === globalCurrentTabId) {
                var status = processActiveTabStatus(sender.tab, request.status);
                updateIcon(status);
            }
            break;

        case 'suspendTab':
            requestTabSuspension(sender.tab);
            break;

        case 'requestUnsuspendTab':
            if (sender.tab && isSuspended(sender.tab)) {
                if (unsuspendRequestList[sender.tab.id] === 'ignore') {
                    delete unsuspendRequestList[sender.tab.id];
                } else {
                    unsuspendRequestList[sender.tab.id] = true;
                }
            }
            break;

        case 'savePreviewData':
            savePreview(sender.tab, request.previewUrl);
            if (debug && sender.tab) {
                if (request.errorMsg) {
                    console.log('Error from content script from tabId ' + sender.tab.id + ': ' + request.errorMsg);
                } else if (request.timerMsg) {
                    console.log('Time taken to generate preview for tabId ' + sender.tab.id + ': ' + request.timerMsg);
                }
            }
            sendResponse();
            break;

        case 'suspendOne':
            suspendHighlightedTab();
            break;

        case 'unsuspendOne':
            unsuspendHighlightedTab();
            break;

        case 'tempWhitelist':
            temporarilyWhitelistHighlightedTab();
            break;

        case 'undoTempWhitelist':
            undoTemporarilyWhitelistHighlightedTab();
            break;

        case 'whitelist':
            whitelistHighlightedTab();
            break;

        case 'removeWhitelist':
            unwhitelistHighlightedTab();
            break;

        case 'suspendAll':
            suspendAllTabs();
            break;

        case 'unsuspendAll':
            unsuspendAllTabs();
            break;

        case 'suspendSelected':
            suspendSelectedTabs();
            break;

        case 'unsuspendSelected':
            unsuspendSelectedTabs();
            break;

        default:
            break;
        }
    }


    //attach listener to runtime
    chrome.runtime.onMessage.addListener(messageRequestListener);
    //attach listener to runtime for external messages, to allow
    //interoperability with other extensions in the manner of an API
    chrome.runtime.onMessageExternal.addListener(messageRequestListener);

    //wishful thinking here that a synchronus iteration through tab views will enable them
    //to unsuspend before the application closes
    chrome.runtime.onSuspend.addListener(function () {
        chrome.extension.getViews({type: 'tab'}).forEach(function (view) {
            view.location.reload();
        });
    });

    //listen for focus changes
    chrome.windows.onFocusChanged.addListener(function (windowId) {
        handleWindowFocusChanged(windowId);
    });
    chrome.tabs.onActivated.addListener(function (activeInfo) {
        handleTabFocusChanged(activeInfo.tabId, activeInfo.windowId);
    });

    //add listeners for session monitoring
    chrome.tabs.onCreated.addListener(function(tab) {
        queueSessionTimer();
    });
    chrome.tabs.onRemoved.addListener(function(tabId, removeInfo) {
        queueSessionTimer();

        if (unsuspendRequestList[tabId]) {
            delete unsuspendRequestList[tabId];
        }
        lastTabCloseTimestamp = new Date();
    });
    chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {

        //only save session if the tab url has changed
        if (changeInfo && changeInfo.url) {
            queueSessionTimer();
        }

        //check for tab playing audio
        if (tab.audible) {
            audibleTabsList[tab.id] = true;

        //else check if tab WAS playing audio (and now isnt)
        } else if (audibleTabsList[tab.id]) {
            delete audibleTabsList[tab.id];
            resetTabTimer(tab.id);
            if (debug) console.log('tab finished playing audio. restarting timer: ' + tab.id);
        }

        //check for tab having an unsuspend request
        if (unsuspendRequestList[tab.id]) {

            //only permit unsuspend if tab is being reloaded
            if (changeInfo && changeInfo.status === 'loading' && isSuspended(tab)) {
                unsuspendTab(tab);

            //otherwise remove unsuspend request
            } else {
                delete unsuspendRequestList[tab.id];
            }
        }
    });
    chrome.windows.onCreated.addListener(function () {
        queueSessionTimer();
    });
    chrome.windows.onRemoved.addListener(function () {
        queueSessionTimer();
    });

    //tidy up history items as they are created
    chrome.history.onVisited.addListener(function (historyItem) {

        var url = historyItem.url;

        if (url.indexOf('suspended.html') >= 0) {
            url = gsUtils.getSuspendedUrl(url);

            //remove suspended tab history item
            chrome.history.deleteUrl({url: historyItem.url});
            chrome.history.addUrl({url: url}, function() {
                if (chrome.runtime.lastError) {
                    console.log(chrome.runtime.lastError.message);
                }
            });
        }
    });

    //add listener for battery state changes
    if (navigator.getBattery) {
        navigator.getBattery().then(function(battery) {

            chargingMode = battery.charging;

            battery.onchargingchange = function () {
                 chargingMode = battery.charging;
            };
        });
    }

    //start job to check for notices (once a day)
    window.setInterval(checkForNotices, 1000 * 60 * 60 * 24);

    _gaq.push(['_setAccount', 'UA-52338347-1']);
    _gaq.push(['_setCustomVar', 1, 'version', chrome.runtime.getManifest().version + "", 1]);
    _gaq.push(['_setCustomVar', 2, 'screen_capture', gsUtils.getOption(gsUtils.SCREEN_CAPTURE) + "", 1]);
    _gaq.push(['_setCustomVar', 3, 'suspend_time', gsUtils.getOption(gsUtils.SUSPEND_TIME) + "", 1]);
    _gaq.push(['_setCustomVar', 4, 'no_nag', gsUtils.getOption(gsUtils.NO_NAG) + "", 1]);
    //_gaq.push(['_setCustomVar', 5, 'migration', gsUtils.getOption(gsUtils.UNSUSPEND_ON_FOCUS) + "", 3]);
    _gaq.push(['_trackPageview']);

    var ga = document.createElement('script');
    ga.type = 'text/javascript';
    ga.async = true;
    ga.src = 'https://ssl.google-analytics.com/ga.js';
    var s = document.getElementsByTagName('script')[0];
    s.parentNode.insertBefore(ga, s);

    return {
        requestTabInfo: requestTabInfo,
        updateIcon: updateIcon,
        isSpecialTab: isSpecialTab,
        saveSuspendData: saveSuspendData,
        sessionId: sessionId,
        runStartupChecks: runStartupChecks,
        resetAllTabTimers: resetAllTabTimers,
        requestNotice: requestNotice,
        buildContextMenu: buildContextMenu,
        resuspendAllSuspendedTabs: resuspendAllSuspendedTabs
    };

}());

tgs.runStartupChecks();

