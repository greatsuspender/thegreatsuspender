/* global gsUtils, chrome, XMLHttpRequest */
/*
 * The Great Suspender
 * Copyright (C) 2017 Dean Oemcke
 * Available under GNU GENERAL PUBLIC LICENSE v2
 * http://github.com/deanoemcke/thegreatsuspender
 * ༼ つ ◕_◕ ༽つ
*/
var _gaq = _gaq || []; // eslint-disable-line no-use-before-define

var tgs = (function () {
    'use strict';

    var debug = false,
        sessionId,
        lastSelectedTabByWindowId = {},
        backgroundTabCreateTimestampByTabId = {},
        globalCurrentTabId,
        sessionSaveTimer,
        chargingMode = false,
        notice = {},
        unsuspendOnReloadByTabId = {},
        temporaryWhitelistOnReloadByTabId = {},
        scrollPosByTabId = {},
        suspensionActiveIcon = '/img/icon19.png',
        suspensionPausedIcon = '/img/icon19b.png';

    //set gloabl sessionId
    sessionId = gsUtils.generateSessionId();
    if (debug) console.log('sessionId: ' + sessionId);

    function saveSuspendData(tab, callback) {

        var tabProperties,
            favUrl;

        if (tab.incognito) {
            favUrl = tab.favIconUrl;
        } else {
            favUrl = 'chrome://favicon/size/16@2x/' + tab.url;
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

        //add suspend information to suspendedTabInfo
        gsUtils.addSuspendedTabInfo(tabProperties, function () {
            if (typeof callback === 'function') callback();
        });
    }

    function isDiscardedTab(tab) {
        return tab.discarded;
    }

    //tests for non-standard web pages. does not check for suspended pages!
    function isSpecialTab(tab) {
        var url = tab.url;

        if ((url.indexOf('chrome-extension:') === 0 && url.indexOf('suspended.html') < 0) ||
                url.indexOf('chrome:') === 0 ||
                url.indexOf('chrome-devtools:') === 0 ||
                url.indexOf('file:') === 0 ||
                url.indexOf('chrome.google.com/webstore') >= 0) {
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

    //ask the tab to suspend itself
    function confirmTabSuspension(tab, tabInfo) {

        var scrollPos = tabInfo.scrollPos || '0';
        saveSuspendData(tab, function () {

            //clear any outstanding tab requests
            delete unsuspendOnReloadByTabId[tab.id];
            delete temporaryWhitelistOnReloadByTabId[tab.id];

            //if we need to save a preview image
            var screenCaptureMode = gsUtils.getOption(gsUtils.SCREEN_CAPTURE);
            if (screenCaptureMode !== '0') {
                chrome.tabs.executeScript(tab.id, { file: 'js/html2canvas.min.js' }, function (result) {

                    if (chrome.runtime.lastError) {
                        console.log(chrome.runtime.lastError.message);
                        return;
                    }

                    var forceScreenCapture = gsUtils.getOption(gsUtils.SCREEN_CAPTURE_FORCE);
                    chrome.tabs.getZoom(tab.id, function (zoomFactor) {
                        if (!forceScreenCapture && zoomFactor !== 1) {
                            sendMessageToTab(tab.id, {
                                action: 'confirmTabSuspend',
                                suspendedUrl: gsUtils.generateSuspendedUrl(tab.url, tab.title, scrollPos)
                            });

                        } else {
                            sendMessageToTab(tab.id, {
                                action: 'generatePreview',
                                suspendedUrl: gsUtils.generateSuspendedUrl(tab.url, tab.title, scrollPos),
                                screenCapture: screenCaptureMode,
                                forceScreenCapture: forceScreenCapture
                            });
                        }
                    });
                });

            } else {
                sendMessageToTab(tab.id, {
                    action: 'confirmTabSuspend',
                    suspendedUrl: gsUtils.generateSuspendedUrl(tab.url, tab.title, scrollPos)
                });
            }
        });
    }

    // forceLevel indicates which users preferences to respect when attempting to suspend the tab
    // 1: Suspend if at all possible
    // 2: Respect whitelist, temporary whitelist, form input, pinned tabs, audible preferences, and exclude active tabs
    // 3: Same as above (2), plus also respect internet connectivity and running on battery preferences.
    function requestTabSuspension(tab, forceLevel) {

        //safety check
        if (typeof tab === 'undefined') return;

        if (forceLevel >= 1) {
            if (isSuspended(tab) || isSpecialTab(tab) || isDiscardedTab(tab)) {
                return;
            }
        }
        if (forceLevel >= 2) {
            if (tab.active || gsUtils.checkWhiteList(tab.url) || isPinnedTab(tab) || isAudibleTab(tab)) {
                return;
            }
        }
        if (forceLevel >= 3) {
            if (gsUtils.getOption(gsUtils.ONLINE_CHECK) && !navigator.onLine) {
                return;
            }
            if (gsUtils.getOption(gsUtils.BATTERY_CHECK) && chargingMode) {
                return;
            }
        }

        requestTabInfoFromContentScript(tab, function (tabInfo) {
            tabInfo = tabInfo || {};
            if (forceLevel >= 2 &&
                    (tabInfo.status === 'formInput' || tabInfo.status === 'tempWhitelist')) {
                return;
            }
            confirmTabSuspension(tab, tabInfo);
        });
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

        //imitate chromes 'open link in new tab' behaviour in how it selects the correct index
        chrome.tabs.query({ windowId: chrome.windows.WINDOW_ID_CURRENT }, function (tabs) {
            var newTabIndex = parentTab.index + 1;
            var nextTab = tabs[newTabIndex];
            while (nextTab && nextTab.openerTabId === parentTab.id) {
                newTabIndex++;
                nextTab = tabs[newTabIndex];
            }
            var newTabProperties = {
                url: linkedUrl,
                index: newTabIndex,
                openerTabId: parentTab.id,
                active: false
            };
            chrome.tabs.create(newTabProperties, function (tab) {
                backgroundTabCreateTimestampByTabId[tab.id] = Date.now();
            });
        });
    }

    function suspendHighlightedTab() {
        chrome.tabs.query({active: true, currentWindow: true}, function (tabs) {
            if (tabs.length > 0) {
                requestTabSuspension(tabs[0], 1);
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
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            var curWindowId = tabs[0].windowId;
            chrome.windows.get(curWindowId, {populate: true}, function (curWindow) {
                curWindow.tabs.forEach(function (tab) {
                    if (!tab.active) {
                        requestTabSuspension(tab, 2);
                    }
                });
            });
        });
    }

    function suspendAllTabsInAllWindows() {
        chrome.tabs.query({}, function (tabs) {
            tabs.forEach(function (currentTab) {
                requestTabSuspension(currentTab, 1);
            });
        });
    }

    function isSuspended(tab) {
        return tab.url.indexOf('suspended.html') > 0;
    }

    function unsuspendAllTabs() {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            var curWindowId = tabs[0].windowId;
            chrome.windows.get(curWindowId, {populate: true}, function (curWindow) {
                curWindow.tabs.forEach(function (currentTab) {
                    if (isSuspended(currentTab)) {
                        unsuspendTab(currentTab);
                    }
                });
            });
        });
    }

    function unsuspendAllTabsInAllWindows() {
        chrome.windows.getCurrent({}, function (currentWindow) {
            chrome.tabs.query({}, function (tabs) {
                // Because of the way that unsuspending steals window focus, we defer the suspending of tabs in the
                // current window until last
                var deferredTabs = [];
                tabs.forEach(function (tab) {
                    if (isSuspended(tab)) {
                        if (tab.windowId === currentWindow.id) {
                            deferredTabs.push(tab);
                        } else {
                            unsuspendTab(tab);
                        }
                    }
                });
                deferredTabs.forEach(function (tab) {
                    unsuspendTab(tab);
                });
            });
        });
    }

    function suspendSelectedTabs() {
        chrome.tabs.query({highlighted: true, lastFocusedWindow: true}, function (selectedTabs) {
            selectedTabs.forEach(function (tab) {
                requestTabSuspension(tab, 1);
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
                    resuspendSuspendedTab(currentTab);
                }
            });
        });
    }

    function resuspendSuspendedTab(tab) {
        sendMessageToTab(tab.id, { action: 'setUnsuspendOnReload', value: false }, function (response) {
            if (chrome.runtime.lastError) {
                console.log(chrome.runtime.lastError);
            }
            chrome.tabs.reload(tab.id);
        });
    }

    function queueSessionTimer() {
        clearTimeout(sessionSaveTimer);
        sessionSaveTimer = setTimeout(function () {
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

    function resetContentScripts(preferencesToUpdate) {
        chrome.tabs.query({}, function (tabs) {
            tabs.forEach(function (currentTab) {
                resetContentScript(currentTab.id, preferencesToUpdate);
            });
        });
    }

    function resetContentScript(tabId, preferencesToUpdate) {
        var messageParams = {action: 'resetPreferences'};
        if (preferencesToUpdate.indexOf(gsUtils.SUSPEND_TIME) > -1) {
            messageParams.suspendTime = gsUtils.getOption(gsUtils.SUSPEND_TIME);
        }
        if (preferencesToUpdate.indexOf(gsUtils.IGNORE_FORMS) > -1) {
            messageParams.ignoreForms = gsUtils.getOption(gsUtils.IGNORE_FORMS);
        }
        sendMessageToTab(tabId, messageParams);
    }

    function unsuspendTab(tab) {
        if (!isSuspended(tab)) return;

        var url = gsUtils.getSuspendedUrl(tab.url),
            scrollPosition = gsUtils.getSuspendedScrollPosition(tab.url);

        scrollPosByTabId[tab.id] = scrollPosition || scrollPosByTabId[tab.id];

        //bit of a hack here as using the chrome.tabs.update method will not allow
        //me to 'replace' the url - leaving a suspended tab in the history
        sendMessageToTab(tab.id, { action: 'unsuspendTab' }, function (response) {

            //if we failed to find the tab with the above method then try to reload the tab directly
            if (chrome.runtime.lastError) {
                console.log('Error requesting unsuspendTab. Will reload directly.', chrome.runtime.lastError);
                chrome.tabs.update(tab.id, {url: url}, function () {
                    if (chrome.runtime.lastError) {
                        console.log(chrome.runtime.lastError.message);
                    }
                });
            }
        });
    }

    function handleWindowFocusChanged(windowId) {

        if (debug) {
            console.log('window changed: ' + windowId);
        }

        chrome.tabs.query({active: true, windowId: windowId}, function (tabs) {
            if (tabs && tabs.length === 1) {

                var currentTab = tabs[0];
                lastSelectedTabByWindowId[windowId] = currentTab.id;
                globalCurrentTabId = currentTab.id;

                //update icon
                requestTabInfo(currentTab.id, function (info) {
                    updateIcon(info.status);
                });
            }
        });
    }

    function handleTabFocusChanged(tabId, windowId) {

        if (debug) {
            console.log('tab changed: ' + tabId);
        }

        var lastSelectedTab = lastSelectedTabByWindowId[windowId];

        lastSelectedTabByWindowId[windowId] = tabId;
        globalCurrentTabId = tabId;

        //reset timer on tab that lost focus
        //TODO: ideally we'd only reset timer on last tab viewed for more than 500ms (as per setTimeout below)
        //but that's getting tricky to determine
        if (lastSelectedTab) {
            resetContentScript(lastSelectedTab, [gsUtils.SUSPEND_TIME]);
        }

        //update icon
        requestTabInfo(tabId, function (info) {
            updateIcon(info.status);
        });

        //pause for a bit before assuming we're on a new tab as some users
        //will key through intermediate tabs to get to the one they want.
        (function () {
            var selectedTabId = tabId;
            setTimeout(function () {
                if (selectedTabId === globalCurrentTabId) {
                    handleNewTabFocus(selectedTabId);
                }
            }, 500);
        }());
    }

    function handleNewTabFocus(tabId) {
        var unsuspend = gsUtils.getOption(gsUtils.UNSUSPEND_ON_FOCUS);

        //optimisation to prevent a chrome.tabs.get call
        if (unsuspend) {

            //get tab object so we can check if it is a suspended tab
            chrome.tabs.get(tabId, function (tab) {
                if (chrome.runtime.lastError) {
                    console.log(chrome.runtime.lastError.message);
                    return;
                }
                if (isSuspended(tab)) {

                    if (navigator.onLine) {
                        unsuspendTab(tab);
                    } else {
                        sendMessageToTab(tab.id, { action: 'showNoConnectivityMessage' });
                    }
                }
            });
        }

        //remove request to instantly suspend this tab id
        delete backgroundTabCreateTimestampByTabId[tabId];

        //clear timer on newly focused tab
        //NOTE: only works if tab is currently unsuspended
        sendMessageToTab(tabId, {action: 'cancelTimer'});
    }

    function runStartupChecks() {

        var lastVersion = gsUtils.fetchLastVersion(),
            curVersion = chrome.runtime.getManifest().version,
            contextMenus = gsUtils.getOption(gsUtils.ADD_CONTEXT);

        //if version has changed then assume initial install or upgrade
        if (!chrome.extension.inIncognitoContext && (lastVersion !== curVersion)) {
            gsUtils.setLastVersion(curVersion);

            //if they are installing for the first time
            if (!lastVersion || lastVersion === '0.0.0') {

                //show welcome screen
                chrome.tabs.create({url: chrome.extension.getURL('welcome.html')});

                //else if they are upgrading to a new version
            } else {

                gsUtils.performMigration(lastVersion);

                //recover tabs silently
                checkForCrashRecovery(true);

                //close any 'update' and 'updated' tabs that may be open
                chrome.tabs.query({url: chrome.extension.getURL('update.html')}, function (tabs) {
                    chrome.tabs.remove(tabs.map(function (tab) { return tab.id; }));
                });
                chrome.tabs.query({url: chrome.extension.getURL('updated.html')}, function (tabs) {
                    chrome.tabs.remove(tabs.map(function (tab) { return tab.id; }));

                    //show updated screen
                    chrome.tabs.create({url: chrome.extension.getURL('updated.html')});
                });
            }

            //else if restarting the same version
        } else {

            //check for possible crash
            checkForCrashRecovery(false);

            //trim excess dbItems
            gsUtils.trimDbItems();
        }

        //inject new content script into all open pages
        reinjectContentScripts();

        //add context menu items
        buildContextMenu(contextMenus);

        //initialise globalCurrentTabId (important that this comes last. cant remember why?!?!)
        chrome.tabs.query({active: true, currentWindow: true}, function (tabs) {
            if (tabs.length > 0) {
                globalCurrentTabId = globalCurrentTabId || tabs[0].id;
            }
        });

        //initialise settings (important that this comes last. cant remember why?!?!)
        gsUtils.initSettings();
    }

    function checkForCrashRecovery(isUpdating) {

        //try to detect whether the extension has crashed as separate to chrome crashing
        //if it is just the extension that has crashed, then in theory all suspended tabs will be gone
        //and all normal tabs will still exist with the same ids

        var suspendedTabCount = 0,
            unsuspendedTabCount = 0,
            suspendedTabs = [],
            tabResponses = [],
            unsuspendedSessionTabs = [],
            currentlyOpenTabs = [];

        if (debug) console.log('Checking for crash recovery');

        gsUtils.fetchLastSession().then(function (lastSession) {

            if (!lastSession) {
                return;
            }
            if (debug) console.log('lastSession: ', lastSession);

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
            if (suspendedTabCount === 0) {
                if (debug) console.log('Aborting tab recovery. Last session has no suspended tabs.');
                return;
            }

            //check to see if they still exist in current session
            chrome.tabs.query({}, function (tabs) {

                if (debug) {
                    console.log('Tabs in current session: ', tabs);
                    console.log('Unsuspended session tabs: ', unsuspendedSessionTabs);
                }

                //don't attempt recovery if there are less tabs in current session than there were
                //unsuspended tabs in the last session
                if (tabs.length < unsuspendedTabCount) {
                    if (debug) {
                        console.log('Aborting tab recovery. Last session contained ' + unsuspendedTabCount +
                            'tabs. Current session only contains ' + tabs.length);
                    }
                    return;
                }

                //if there is only one currently open tab and it is the 'new tab' page then abort recovery
                if (tabs.length === 1 && tabs[0].url === 'chrome://newtab/') {
                    if (debug) {
                        console.log('Aborting tab recovery. Current session only contains a single newtab page.');
                    }
                    return;
                }

                //check for suspended tabs and try to contact them
                tabs.forEach(function (curTab) {
                    currentlyOpenTabs[curTab.id] = curTab;

                    //test if a suspended tab has crashed by sending a 'requestInfo' message
                    if (!isSpecialTab(curTab) && isSuspended(curTab)) {
                        suspendedTabs.push(curTab);
                        sendMessageToTab(curTab.id, {action: 'requestInfo'}, function (response) {
                            tabResponses[curTab.id] = true;
                        });
                    }
                });

                //after 5 seconds, try to reload any suspended tabs that haven't respond for whatever reason (usually because the tab has crashed)
                if (suspendedTabs.length > 0) {
                    setTimeout(function () {
                        suspendedTabs.forEach(function (curTab) {
                            if (typeof tabResponses[curTab.id] === 'undefined') {

                                //automatically reload unresponsive suspended tabs
                                chrome.tabs.reload(curTab.id);
                            }
                        });
                    }, 5000);

                    //don't attempt recovery if there are still suspended tabs open
                    if (debug) console.log('Will not attempt recovery as there are still suspended tabs open.');
                    return;
                }

                //if we are doing an update, then automatically recover lost tabs
                if (isUpdating) {
                    gsUtils.recoverLostTabs(null);
                //otherwise show the recovery page
                } else {
                    chrome.tabs.create({url: chrome.extension.getURL('recovery.html')});
                }
            });
        });
    }

    function reinjectContentScripts() {
        chrome.tabs.query({}, function (tabs) {
            var timeout = gsUtils.getOption(gsUtils.SUSPEND_TIME);

            tabs.forEach(function (currentTab) {
                if (!isSpecialTab(currentTab) && !isSuspended(currentTab) && !isDiscardedTab(currentTab)) {
                    var tabId = currentTab.id;

                    chrome.tabs.executeScript(tabId, {file: 'js/contentscript.js'}, function () {
                        if (chrome.runtime.lastError) {
                            console.log(chrome.runtime.lastError.message);
                        } else {
                            sendMessageToTab(tabId, {action: 'resetPreferences', suspendTime: timeout});
                        }
                    });
                }
            });
        });
    }

    function checkForNotices() {

        var xhr = new XMLHttpRequest(),
            lastNoticeVersion = gsUtils.fetchNoticeVersion();

        xhr.open('GET', 'https://greatsuspender.github.io/notice.json', true);
        xhr.timeout = 4000;
        xhr.setRequestHeader('Cache-Control', 'no-cache');
        xhr.onreadystatechange = function () {
            if (xhr.readyState === 4 && xhr.responseText) {
                var resp = JSON.parse(xhr.responseText);

                //only show notice if it is intended for this version and it has not already been shown
                if (resp && resp.active && resp.text && resp.title &&
                    resp.target === chrome.runtime.getManifest().version &&
                    resp.version !== lastNoticeVersion) {

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

    //get info for a tab
    //returns the current tab suspension and timer states. possible suspension states are:

    //normal: a tab that will be suspended
    //special: a tab that cannot be suspended
    //suspended: a tab that is suspended
    //discarded: a tab that has been discarded
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

        tabId = tabId || globalCurrentTabId;

        var info = {
            windowId: '',
            tabId: '',
            status: 'unknown',
            timerUp: '-'
        };

        if (typeof tabId === 'undefined') {
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

                //check if tab has been discarded
                } else if (isDiscardedTab(tab)) {
                    info.status = 'discarded';
                    callback(info);

                //check if it has already been suspended
                } else if (isSuspended(tab)) {
                    info.status = 'suspended';
                    callback(info);

                //request tab state and timer state from the content script
                } else {
                    requestTabInfoFromContentScript(tab, function (tabInfo) {
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
        sendMessageToTab(tab.id, {action: 'requestInfo'}, callback);
    }

    function processActiveTabStatus(tab, contentScriptStatus) {

        var suspendTime = gsUtils.getOption(gsUtils.SUSPEND_TIME),
            onlySuspendOnBattery = gsUtils.getOption(gsUtils.BATTERY_CHECK),
            onlySuspendWithInternet = gsUtils.getOption(gsUtils.ONLINE_CHECK);

        var status = contentScriptStatus;

        //check whitelist (ignore contentScriptStatus)
        if (gsUtils.checkWhiteList(tab.url)) {
            status = 'whitelisted';

        //check never suspend (ignore contentScriptStatus)
        //should come after whitelist check as it causes popup to show the whitelisting option
        } else if (suspendTime === '0') {
            status = 'never';

        //check running on battery
        } else if (contentScriptStatus === 'normal' && onlySuspendOnBattery && chargingMode) {
            status = 'charging';

        //check internet connectivity
        } else if (contentScriptStatus === 'normal' && onlySuspendWithInternet && !navigator.onLine) {
            status = 'noConnectivity';

        //check pinned tab
        } else if (contentScriptStatus === 'normal' && isPinnedTab(tab)) {
            status = 'pinned';

        //check audible tab
        } else if (contentScriptStatus === 'normal' && isAudibleTab(tab)) {
            status = 'audible';
        }
        return status;
    }

    //change the icon to either active or inactive
    function updateIcon(status) {
        var icon = status !== 'normal' ? suspensionPausedIcon : suspensionActiveIcon;
        chrome.browserAction.setIcon({ path: icon, tabId: globalCurrentTabId });
    }

    //HANDLERS FOR RIGHT-CLICK CONTEXT MENU

    function buildContextMenu(showContextMenu) {

        var allContexts = ['page', 'frame', 'editable', 'image', 'video', 'audio']; //'selection',

        chrome.contextMenus.removeAll();

        if (showContextMenu) {

            chrome.contextMenus.create({
                title: chrome.i18n.getMessage('js_background_suspend_tab'),
                contexts: allContexts,
                onclick: suspendHighlightedTab
            });
            chrome.contextMenus.create({
                title: chrome.i18n.getMessage('js_background_dont_suspend_now'),
                contexts: allContexts,
                onclick: temporarilyWhitelistHighlightedTab
            });
            chrome.contextMenus.create({
                title: chrome.i18n.getMessage('js_background_never_suspend_site'),
                contexts: allContexts,
                onclick: whitelistHighlightedTab
            });

            chrome.contextMenus.create({
                contexts: allContexts,
                type: 'separator'
            });

            chrome.contextMenus.create({
                title: chrome.i18n.getMessage('js_background_suspend_other_tabs_in_window'),
                contexts: allContexts,
                onclick: suspendAllTabs
            });
            chrome.contextMenus.create({
                title: chrome.i18n.getMessage('js_background_unsuspend_all_tabs_in_window'),
                contexts: allContexts,
                onclick: unsuspendAllTabs
            });

            chrome.contextMenus.create({
                contexts: allContexts,
                type: 'separator'
            });

            chrome.contextMenus.create({
                title: chrome.i18n.getMessage('js_background_force_suspend_all_tabs'),
                contexts: allContexts,
                onclick: suspendAllTabsInAllWindows
            });
            chrome.contextMenus.create({
                title: chrome.i18n.getMessage('js_background_unsuspend_all_tabs'),
                contexts: allContexts,
                onclick: unsuspendAllTabsInAllWindows
            });
        }

        chrome.contextMenus.create({
            title: chrome.i18n.getMessage('js_background_open_link_in_suspended_tab'),
            contexts: ['link'],
            onclick: function (info, tab) {
                openLinkInSuspendedTab(tab, info.linkUrl);
            }
        });
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
        } catch (e) {
            chrome.tabs.sendMessage(tabId, message, callback);
        }
    }

    function messageRequestListener(request, sender, sendResponse) {
        if (debug) {
            console.log('listener fired:', request.action);
            console.dir(sender);
        }

        switch (request.action) {
        case 'initTab':

            var suspendTime = gsUtils.getOption(gsUtils.SUSPEND_TIME);
            var isTempWhitelist = temporaryWhitelistOnReloadByTabId[sender.tab.id];
            sendResponse({
                dontSuspendForms: gsUtils.getOption(gsUtils.IGNORE_FORMS),
                suspendTime: suspendTime,
                screenCapture: gsUtils.getOption(gsUtils.SCREEN_CAPTURE),
                scrollPos: scrollPosByTabId[sender.tab.id] || '0',
                temporaryWhitelist: isTempWhitelist
            });
            delete temporaryWhitelistOnReloadByTabId[sender.tab.id];
            delete scrollPosByTabId[sender.tab.id];

            // If tab is currently visible then update popup icon
            if (sender.tab && sender.tab.id === globalCurrentTabId) {
                var contentScriptState = isTempWhitelist ? 'tempWhitelist' : 'normal';
                updateIcon(processActiveTabStatus(sender.tab, contentScriptState));
            }
            return false;

        case 'reportTabState':
            // If tab is currently visible then update popup icon
            if (sender.tab && sender.tab.id === globalCurrentTabId) {
                updateIcon(processActiveTabStatus(sender.tab, request.status));
            }
            return false;

        case 'suspendTab':
            requestTabSuspension(sender.tab, 3);
            return false;

        case 'requestUnsuspendTab':
            if (sender.tab && isSuspended(sender.tab)) {
                if (request.addToTemporaryWhitelist) {
                    temporaryWhitelistOnReloadByTabId[sender.tab.id] = true;
                }
                unsuspendTab(sender.tab);
            }
            return true;

        case 'requestUnsuspendOnReload':
            if (sender.tab && isSuspended(sender.tab)) {
                unsuspendOnReloadByTabId[sender.tab.id] = true;
            }
            return false;

        case 'savePreviewData':
            if (debug && sender.tab) {
                if (request.errorMsg) {
                    console.log('Error from content script from tabId ' + sender.tab.id + ': ' + request.errorMsg);
                }
                if (request.timerMsg) {
                    console.log('Time taken to generate preview for tabId ' + sender.tab.id + ': ' + request.timerMsg);
                }
            }
            if (request.previewUrl) {
                gsUtils.addPreviewImage(sender.tab.url, request.previewUrl, function () {
                    sendResponse();
                });
            } else {
                sendResponse();
            }
            return true;

        default:
            return false;
        }
    }

    //attach listener to runtime
    chrome.runtime.onMessage.addListener(messageRequestListener);
    //attach listener to runtime for external messages, to allow
    //interoperability with other extensions in the manner of an API
    chrome.runtime.onMessageExternal.addListener(messageRequestListener);

    //wishful thinking here that a synchronus iteration through tab views will enable them
    //to unsuspend before the application closes
    chrome.runtime.setUninstallURL('', function () {
        chrome.extension.getViews({type: 'tab'}).forEach(function (view) {
            view.location.reload();
        });
    });

    //handle special event where an extension update is available
    chrome.runtime.onUpdateAvailable.addListener(function (details) {
        var currentVersion = chrome.runtime.getManifest().version;
        var newVersion = details.version;

        console.log('A new version is available: ' + currentVersion + ' -> ' + newVersion);

        var currentSession;
        gsUtils.fetchSessionById(sessionId).then(function (session) {
            currentSession = session;
            return gsUtils.fetchCurrentSessions();
        }).then(function (sessions) {
            if (!currentSession && sessions && sessions.length > 0) {
                currentSession = sessions[0];
            }
            if (currentSession) {
                currentSession.name = 'Automatic save point for v' + currentVersion;
                gsUtils.addToSavedSessions(currentSession);
            }
        }).then(function () {
            if (gsUtils.getSuspendedTabCount() > 0) {
                if (!gsUtils.isExtensionTabOpen('update')) {
                    chrome.tabs.create({url: chrome.extension.getURL('update.html')});
                }

                // if there are no suspended tabs then simply install the update immediately
            } else {
                chrome.runtime.reload();
            }
        });
    });

    chrome.windows.onFocusChanged.addListener(function (windowId) {
        handleWindowFocusChanged(windowId);
    });
    chrome.tabs.onActivated.addListener(function (activeInfo) {
        handleTabFocusChanged(activeInfo.tabId, activeInfo.windowId);
    });
    chrome.tabs.onCreated.addListener(function (tab) {
        queueSessionTimer();
    });
    chrome.tabs.onRemoved.addListener(function (tabId, removeInfo) {
        queueSessionTimer();
        delete unsuspendOnReloadByTabId[tabId];
        delete temporaryWhitelistOnReloadByTabId[tabId];
        delete backgroundTabCreateTimestampByTabId[tabId];
    });
    chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {

        if (!changeInfo) return;
        if (debug) console.log('tab updated. tabId: ', tabId, changeInfo);

        //only save session if the tab url has changed
        if (changeInfo.url) {
            queueSessionTimer();
        }

        //check for change in tabs audible status
        if (changeInfo.hasOwnProperty('audible')) {

            //reset tab timer if tab has just finished playing audio
            if (!changeInfo.audible && gsUtils.getOption(gsUtils.IGNORE_AUDIO)) {
                resetContentScript(tab.id, [gsUtils.SUSPEND_TIME]);
            }
            //if tab is currently visible then update popup icon
            if (tabId === globalCurrentTabId) {
                updateIcon(processActiveTabStatus(tab, 'normal'));
            }
        }

        //check for change in tabs pinned status
        if (changeInfo.hasOwnProperty('pinned') && tabId === globalCurrentTabId) {
            updateIcon(processActiveTabStatus(tab, 'normal'));
        }

        if (isSuspended(tab)) {
            //reload if tab does not have an unsuspend request. only permit unsuspend if tab is being reloaded
            if (changeInfo.status === 'loading') {
                if (unsuspendOnReloadByTabId[tabId]) {
                    unsuspendTab(tab);
                }
                delete unsuspendOnReloadByTabId[tabId];

            } else if (changeInfo.status === 'complete') {
                //set the setUnsuspendOnReload to true
                sendMessageToTab(tabId, { action: 'setUnsuspendOnReload', value: true });

                //remove request to instantly suspend this tab id
                delete backgroundTabCreateTimestampByTabId[tabId];

                if (tabId === globalCurrentTabId) {
                    updateIcon('suspended');
                }
            }

        } else {
            if (changeInfo.status === 'complete') {
                var backgroundTabCreateTimestamp = backgroundTabCreateTimestampByTabId[tab.id];
                //safety check that only allows tab to auto suspend if it has been less than 300 seconds since background tab created
                if (tab && backgroundTabCreateTimestamp && ((Date.now() - backgroundTabCreateTimestamp) / 1000 < 300)) {
                    requestTabSuspension(tab, 1);
                }
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
            chrome.history.addUrl({url: url}, function () {
                if (chrome.runtime.lastError) {
                    console.log(chrome.runtime.lastError.message);
                }
            });
        }
    });

    //add listener for battery state changes
    if (navigator.getBattery) {
        navigator.getBattery().then(function (battery) {

            chargingMode = battery.charging;

            battery.onchargingchange = function () {
                chargingMode = battery.charging;
                requestTabInfo(false, function (info) {
                    updateIcon(info.status);
                });
            };
        });
    }

    //add listeners for online/offline state changes
    window.addEventListener('online', function () {
        requestTabInfo(false, function (info) {
            updateIcon(info.status);
        });
    });
    window.addEventListener('offline', function () {
        requestTabInfo(false, function (info) {
            updateIcon(info.status);
        });
    });

    //start job to check for notices (once a day)
    window.setInterval(checkForNotices, 1000 * 60 * 60 * 24);

    _gaq.push(['_setAccount', 'UA-52338347-1']);
    _gaq.push(['_setCustomVar', 1, 'version', chrome.runtime.getManifest().version + '', 1]);
    _gaq.push(['_setCustomVar', 2, 'screen_capture', gsUtils.getOption(gsUtils.SCREEN_CAPTURE) + '', 1]);
    _gaq.push(['_setCustomVar', 3, 'suspend_time', gsUtils.getOption(gsUtils.SUSPEND_TIME) + '', 1]);
    _gaq.push(['_setCustomVar', 4, 'no_nag', gsUtils.getOption(gsUtils.NO_NAG) + '', 1]);
    //_gaq.push(['_setCustomVar', 5, 'migration', gsUtils.getOption(gsUtils.UNSUSPEND_ON_FOCUS) + "", 3]);
    _gaq.push(['_trackPageview']);

    var ga = document.createElement('script');
    ga.type = 'text/javascript';
    ga.async = true;
    ga.src = 'https://ssl.google-analytics.com/ga.js';
    var s = document.getElementsByTagName('script')[0];
    s.parentNode.insertBefore(ga, s);

    return {
        isSpecialTab: isSpecialTab,
        isSuspended: isSuspended,
        sessionId: sessionId,
        runStartupChecks: runStartupChecks,
        resetContentScripts: resetContentScripts,
        requestNotice: requestNotice,
        buildContextMenu: buildContextMenu,
        resuspendAllSuspendedTabs: resuspendAllSuspendedTabs,
        resuspendSuspendedTab: resuspendSuspendedTab,

        updateIcon: updateIcon,
        requestTabInfo: requestTabInfo,

        //external action handlers
        unsuspendHighlightedTab: unsuspendHighlightedTab,
        unwhitelistHighlightedTab: unwhitelistHighlightedTab,
        undoTemporarilyWhitelistHighlightedTab: undoTemporarilyWhitelistHighlightedTab,
        suspendHighlightedTab: suspendHighlightedTab,
        suspendAllTabs: suspendAllTabs,
        unsuspendAllTabs: unsuspendAllTabs,
        suspendSelectedTabs: suspendSelectedTabs,
        unsuspendSelectedTabs: unsuspendSelectedTabs,
        whitelistHighlightedTab: whitelistHighlightedTab,
        temporarilyWhitelistHighlightedTab: temporarilyWhitelistHighlightedTab,
        unsuspendAllTabsInAllWindows: unsuspendAllTabsInAllWindows
    };

}());

tgs.runStartupChecks();
