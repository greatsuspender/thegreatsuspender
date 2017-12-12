/* global gsStorage, gsUtils, gsSession, gsMessages, chrome, XMLHttpRequest */
/*
 * The Great Suspender
 * Copyright (C) 2017 Dean Oemcke
 * Available under GNU GENERAL PUBLIC LICENSE v2
 * http://github.com/deanoemcke/thegreatsuspender
 * ༼ つ ◕_◕ ༽つ
*/
var tgs = (function () { // eslint-disable-line no-unused-vars
    'use strict';

    var TEMP_WHITELIST_ON_RELOAD = 'whitelistOnReload';
    var UNSUSPEND_ON_RELOAD = 'unsuspendOnReload';
    var SCROLL_POS = 'scrollPos';
    var CREATE_TIMESTAMP = 'createTimestamp';

    var lastSelectedTabByWindowId = {},
        globalCurrentTabId,
        sessionSaveTimer,
        newTabFocusTimer,
        noticeToDisplay,
        chargingMode = false,
        recoveryMode = false,
        suspensionActiveIcon = '/img/icon19.png',
        suspensionPausedIcon = '/img/icon19b.png';

    var tabFlagsByTabId = {};


    function init() {

        //initialise globalCurrentTabId
        getCurrentlyActiveTab(function (activeTab) {
            if (activeTab) {
                globalCurrentTabId = globalCurrentTabId || activeTab.id;
            }
        });
    }

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
        gsStorage.addSuspendedTabInfo(tabProperties, function () {
            if (typeof callback === 'function') callback();
        });
    }

    function confirmTabSuspension(tab, suspendedUrl) {
        gsMessages.sendConfirmSuspendToContentScript(tab.id, suspendedUrl, function (err) {
            if (err) chrome.tabs.update(tab.id, {url: suspendedUrl});
        });
    }

    //ask the tab to suspend itself
    function requestTabSuspension(tab, tabInfo) {

        var scrollPos = tabInfo.scrollPos || '0';
        var suspendedUrl = gsUtils.generateSuspendedUrl(tab.url, tab.title, scrollPos);

        saveSuspendData(tab, function () {

            var screenCaptureMode = gsStorage.getOption(gsStorage.SCREEN_CAPTURE);
            if (screenCaptureMode === '0') {
                confirmTabSuspension(tab, suspendedUrl);
                return;
            }

            //if we need to save a preview image
            gsMessages.executeScriptOnTab(tab.id, 'js/html2canvas.min.js', function (err) {
                if (err) {
                    confirmTabSuspension(tab, suspendedUrl);
                    return;
                }

                var forceScreenCapture = gsStorage.getOption(gsStorage.SCREEN_CAPTURE_FORCE);
                chrome.tabs.getZoom(tab.id, function (zoomFactor) {
                    if (!forceScreenCapture && zoomFactor !== 1) {
                        confirmTabSuspension(tab, suspendedUrl);
                        return;
                    }
                    gsMessages.sendGeneratePreviewToContentScript(tab.id, screenCaptureMode, forceScreenCapture, function (err, response) {
                        if (err || !response) {
                            confirmTabSuspension(tab, suspendedUrl);
                            return;
                        }
                        if (response.errorMsg) {
                            gsUtils.log(tab.id, 'Error from content script: ' + response.errorMsg);
                        }
                        if (response.timerMsg) {
                            gsUtils.log(tab.id, 'Time taken to generate preview: ' + response.timerMsg);
                        }
                        if (response.cancelled) {
                            return;
                        }
                        gsStorage.addPreviewImage(tab.url, response.previewUrl, function () {
                            confirmTabSuspension(tab, suspendedUrl);
                        });
                    });
                });
            });
        });
    }

    // forceLevel indicates which users preferences to respect when attempting to suspend the tab
    // 1: Suspend if at all possible
    // 2: Respect whitelist, temporary whitelist, form input, pinned tabs, audible preferences, and exclude active tabs
    // 3: Same as above (2), plus also respect internet connectivity and running on battery preferences.
    function attemptTabSuspension(tab, forceLevel) {

        //safety check
        if (typeof tab === 'undefined') return;

        if (forceLevel >= 1) {
            if (gsUtils.isSuspendedTab(tab) || gsUtils.isSpecialTab(tab) || gsUtils.isDiscardedTab(tab)) {
                return;
            }
        }
        if (forceLevel >= 2) {
            if (tab.active || gsUtils.checkWhiteList(tab.url) || gsUtils.isPinnedTab(tab) || gsUtils.isAudibleTab(tab)) {
                return;
            }
        }
        if (forceLevel >= 3) {
            if (gsStorage.getOption(gsStorage.ONLINE_CHECK) && !navigator.onLine) {
                return;
            }
            if (gsStorage.getOption(gsStorage.BATTERY_CHECK) && chargingMode) {
                return;
            }
        }

        gsMessages.sendRequestInfoToContentScript(tab.id, function (err, tabInfo) {
            tabInfo = tabInfo || {};
            if (forceLevel >= 2 && (tabInfo.status === 'formInput' || tabInfo.status === 'tempWhitelist')) {
                return;
            }
            requestTabSuspension(tab, tabInfo);
        });
    }

    function getCurrentlyActiveTab(callback) {
        chrome.tabs.query({active: true, currentWindow: true}, function (tabs) {
            if (tabs.length > 0) {
                callback(tabs[0]);
            }
            else {
                //TODO: Possibly fallback on globalCurrentTabId here?
                //see https://github.com/deanoemcke/thegreatsuspender/issues/574
                callback(null);
            }
        });
    }

    function whitelistHighlightedTab() {
        getCurrentlyActiveTab(function (activeTab) {
            if (activeTab) {
                var rootUrlStr = gsUtils.getRootUrl(activeTab.url);
                gsUtils.saveToWhitelist(rootUrlStr);
                if (gsUtils.isSuspendedTab(activeTab)) {
                    unsuspendTab(activeTab);
                } else {
                    calculateTabStatus(activeTab, null, function (status) {
                        setIconStatus(status);
                    });
                }
            }
        });
    }

    function unwhitelistHighlightedTab() {
        getCurrentlyActiveTab(function (activeTab) {
            if (activeTab) {
                gsUtils.removeFromWhitelist(activeTab.url);
                calculateTabStatus(activeTab, null, function (status) {
                    setIconStatus(status);
                });
            }
        });
    }

    function temporarilyWhitelistHighlightedTab() {
        getCurrentlyActiveTab(function (activeTab) {
            if (activeTab) {
                gsMessages.sendTemporaryWhitelistToContentScript(activeTab.id, function (response) {
                    var contentScriptStatus = (response && response.status) ? response.status : null;
                    calculateTabStatus(activeTab, contentScriptStatus, function (status) {
                        setIconStatus(status);
                    });
                });
            }
        });
    }

    function undoTemporarilyWhitelistHighlightedTab() {
        getCurrentlyActiveTab(function (activeTab) {
            if (activeTab) {
                gsMessages.sendUndoTemporaryWhitelistToContentScript(activeTab.id, function (response) {
                    var contentScriptStatus = (response && response.status) ? response.status : null;
                    calculateTabStatus(activeTab, contentScriptStatus, function (status) {
                        setIconStatus(status);
                    });
                });
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
                setTabFlagForTabId(tab.id, CREATE_TIMESTAMP,  Date.now());
            });
        });
    }

    function toggleSuspendedStateOfHighlightedTab() {
        getCurrentlyActiveTab(function (activeTab) {
            if (activeTab) {
                if (gsUtils.isSuspendedTab(activeTab)) {
                    unsuspendTab(activeTab);
                } else {
                    attemptTabSuspension(activeTab, 1);
                }
            }
        });
    }

    function suspendHighlightedTab() {
        getCurrentlyActiveTab(function (activeTab) {
            if (activeTab) {
                attemptTabSuspension(activeTab, 1);
            }
        });
    }

    function unsuspendHighlightedTab() {
        getCurrentlyActiveTab(function (activeTab) {
            if (activeTab && gsUtils.isSuspendedTab(activeTab)) {
                unsuspendTab(activeTab);
            }
        });
    }

    function suspendAllTabs() {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            var curWindowId = tabs[0].windowId;
            chrome.windows.get(curWindowId, {populate: true}, function (curWindow) {
                curWindow.tabs.forEach(function (tab) {
                    if (!tab.active) {
                        attemptTabSuspension(tab, 2);
                    }
                });
            });
        });
    }

    function suspendAllTabsInAllWindows() {
        chrome.tabs.query({}, function (tabs) {
            tabs.forEach(function (currentTab) {
                attemptTabSuspension(currentTab, 1);
            });
        });
    }

    function unsuspendAllTabs() {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            var curWindowId = tabs[0].windowId;
            chrome.windows.get(curWindowId, {populate: true}, function (curWindow) {
                curWindow.tabs.forEach(function (currentTab) {
                    if (gsUtils.isSuspendedTab(currentTab)) {
                        unsuspendTab(currentTab);
                    }
                    else if (gsUtils.isNormalTab(currentTab)) {
                        gsMessages.sendRestartTimerToContentScript(currentTab.id);
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
                    if (gsUtils.isSuspendedTab(tab)) {
                        if (tab.windowId === currentWindow.id) {
                            deferredTabs.push(tab);
                        } else {
                            unsuspendTab(tab);
                        }
                    }
                    else if (gsUtils.isNormalTab(tab)) {
                        gsMessages.sendRestartTimerToContentScript(tab.id);
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
                attemptTabSuspension(tab, 1);
            });
        });
    }

    function unsuspendSelectedTabs() {
        chrome.tabs.query({highlighted: true, lastFocusedWindow: true}, function (selectedTabs) {
            selectedTabs.forEach(function (tab) {
                if (gsUtils.isSuspendedTab(tab)) {
                    unsuspendTab(tab);
                }
            });
        });
    }

    function resuspendAllSuspendedTabs() {
        chrome.tabs.query({}, function (tabs) {
            tabs.forEach(function (currentTab) {
                if (gsUtils.isSuspendedTab(currentTab, true)) {
                    resuspendSuspendedTab(currentTab);
                }
            });
        });
    }

    function resuspendSuspendedTab(tab) {
        gsMessages.sendDisableUnsuspendOnReloadToSuspendedTab(tab.id, function (err) {
            if (!err) chrome.tabs.reload(tab.id);
        });
    }

    function queueSessionTimer() {
        clearTimeout(sessionSaveTimer);
        sessionSaveTimer = setTimeout(function () {
            gsUtils.log('background', 'savingWindowHistory');
            saveWindowHistory();
        }, 1000);
    }

    function saveWindowHistory() {
        chrome.windows.getAll({populate: true}, function (windows) {
            //uses global sessionId
            gsUtils.saveWindowsToSessionHistory(gsSession.getSessionId(), windows);
        });
    }

    function getTabFlagForTabId(tabId, tabFlag) {
        return tabFlagsByTabId[tabId] ? tabFlagsByTabId[tabId][tabFlag] : undefined;
    }
    function setTabFlagForTabId(tabId, tabFlag, flagValue) {
        var tabFlags = tabFlagsByTabId[tabId] || {};
        tabFlags[tabFlag] = flagValue;
        tabFlagsByTabId[tabId] = tabFlags;
    }
    function clearTabFlagsForTabId(tabId) {
        delete tabFlagsByTabId[tabId];
    }

    function setRecoveryMode(value) {
        recoveryMode = value;
    }

    function unsuspendTab(tab) {
        if (!gsUtils.isSuspendedTab(tab)) return;

        gsMessages.sendUnsuspendRequestToSuspendedTab(tab.id, function (err) {

            //if we failed to find the tab with the above method then try to reload the tab directly
            var url = gsUtils.getSuspendedUrl(tab.url);
            if (err && url) {
                gsUtils.log(tab.id, 'Will reload directly.');
                chrome.tabs.update(tab.id, {url: url});
            }
        });
    }

    function handleUnsuspendedTabChanged(tab, changeInfo) {
        var hasTabStatusChanged = false;

        //check for change in tabs audible status
        if (changeInfo.hasOwnProperty('audible')) {

            //reset tab timer if tab has just finished playing audio
            if (!changeInfo.audible && gsStorage.getOption(gsStorage.IGNORE_AUDIO)) {
                gsMessages.sendRestartTimerToContentScript(tab.id);
            }
            hasTabStatusChanged = true;
        }
        if (changeInfo.hasOwnProperty('pinned')) {
            hasTabStatusChanged = true;
        }

        //if page has finished loading
        if (changeInfo.status === 'complete') {
            var spawnedTabCreateTimestamp = getTabFlagForTabId(tab.id, CREATE_TIMESTAMP);
            //safety check that only allows tab to auto suspend if it has been less than 300 seconds since spawned tab created
            if (spawnedTabCreateTimestamp && ((Date.now() - spawnedTabCreateTimestamp) / 1000 < 300)) {
                attemptTabSuspension(tab, 1);
                return;
            }

            //init loaded tab
            var ignoreForms = gsStorage.getOption(gsStorage.IGNORE_FORMS);
            var isTempWhitelist = getTabFlagForTabId(tab.id, TEMP_WHITELIST_ON_RELOAD);
            var scrollPos = getTabFlagForTabId(tab.id, SCROLL_POS) || null;
            var suspendTime = tab.active ? null : gsStorage.getOption(gsStorage.SUSPEND_TIME);
            gsMessages.sendInitTabToContentScript(tab.id, ignoreForms, isTempWhitelist, scrollPos, suspendTime);
            clearTabFlagsForTabId(tab.id);
            hasTabStatusChanged = true;
        }

        //if tab is currently visible then update popup icon
        if (hasTabStatusChanged && tab.id === globalCurrentTabId) {
            calculateTabStatus(tab, null, function (status) {
                setIconStatus(status);
            });
        }
    }

    function handleSuspendedTabChanged(tab, changeInfo) {
        //reload if tab does not have an unsuspend request. only permit unsuspend if tab is being reloaded
        if (changeInfo.status === 'loading') {
            var unsuspendOnReload = getTabFlagForTabId(tab.id, UNSUSPEND_ON_RELOAD);
            if (unsuspendOnReload) {
                unsuspendTab(tab);
            }
            setTabFlagForTabId(tab.id, UNSUSPEND_ON_RELOAD, false);

        } else if (changeInfo.status === 'complete') {
            //initialized suspended tab
            var url = gsUtils.getSuspendedUrl(tab.url);
            gsStorage.fetchTabInfo(url).then(function (tabProperties) {
                gsMessages.sendInitSuspendedTab(tab.id, tabProperties);
            });
            clearTabFlagsForTabId(tab.id);

            if (tab.id === globalCurrentTabId) {
                setIconStatus('suspended');
            }

            if (recoveryMode) {
                chrome.tabs.query({url: chrome.extension.getURL('recovery.html')}, function (recoveryTabs) {
                    for (var recoveryTab of recoveryTabs) {
                        gsMessages.sendTabInfoToRecoveryTab(recoveryTab.id, tab);
                    }
                });
            }
        }
    }

    function handleWindowFocusChanged(windowId) {
        if (windowId < 0) {
            return;
        }
        gsUtils.log(windowId, 'window changed');
        chrome.tabs.query({active: true, windowId: windowId}, function (tabs) {
            if (tabs && tabs.length === 1) {

                var currentTab = tabs[0];
                lastSelectedTabByWindowId[windowId] = currentTab;
                globalCurrentTabId = currentTab.id;

                //update icon
                calculateTabStatus(currentTab, null, function (status) {
                    setIconStatus(status);
                });
            }
        });
    }

    function handleTabFocusChanged(tabId, windowId) {
        gsUtils.log(tabId, 'tab gained focus');
        globalCurrentTabId = tabId;

        chrome.tabs.get(tabId, function (newTab) {
            if (chrome.runtime.lastError) {
                gsUtils.error(tabId, chrome.runtime.lastError.message);
                return;
            }

            //update icon
            calculateTabStatus(newTab, null, function (status) {
                setIconStatus(status);
            });

            //pause for a bit before assuming we're on a new tab as some users
            //will key through intermediate tabs to get to the one they want.
            queueNewTabFocusTimer(tabId, windowId, newTab);
        });
    }

    function queueNewTabFocusTimer(tabId, windowId, newTab) {
        clearTimeout(newTabFocusTimer);
        newTabFocusTimer = setTimeout(function () {
            handleNewTabFocus(tabId, windowId, newTab);
        }, 500);
    }

    function handleNewTabFocus(tabId, windowId, newTab) {
        var lastSelectedTab = lastSelectedTabByWindowId[windowId];
        lastSelectedTabByWindowId[windowId] = newTab;

        //remove request to instantly suspend this tab id
        if (getTabFlagForTabId(tabId, CREATE_TIMESTAMP)) {
            setTabFlagForTabId(tabId, CREATE_TIMESTAMP, false);
        }

        if (gsUtils.isSuspendedTab(newTab)) {
            var autoUnsuspend = gsStorage.getOption(gsStorage.UNSUSPEND_ON_FOCUS);
            if (autoUnsuspend) {
                if (navigator.onLine) {
                    unsuspendTab(newTab);
                } else {
                    gsMessages.sendNoConnectivityMessageToSuspendedTab(newTab.id);
                }
            }

        } else if (gsUtils.isNormalTab(newTab)) {
            //clear timer on newly focused tab
            gsMessages.sendClearTimerToContentScript(tabId, function (response) {
            });

        } else if (newTab.url === chrome.extension.getURL('options.html')) {
            gsMessages.sendReloadOptionsToOptionsTab(newTab.id);
        }

        //Reset timer on tab that lost focus.
        //NOTE: it's possible lastSelectedTab was actually closed (causing new tab focus)
        //In this case, lastSelectedTab should be null
        if (lastSelectedTab && gsUtils.isNormalTab(lastSelectedTab)) {
            gsMessages.sendRestartTimerToContentScript(lastSelectedTab.id);
        }
    }

    function checkForNotices() {

        var xhr = new XMLHttpRequest();
        var lastNoticeVersion = gsStorage.fetchNoticeVersion();

        xhr.open('GET', 'https://greatsuspender.github.io/notice.json', true);
        xhr.timeout = 4000;
        xhr.setRequestHeader('Cache-Control', 'no-cache');
        xhr.onreadystatechange = function () {
            if (xhr.readyState === 4 && xhr.responseText) {
                var resp;
                try {
                    resp = JSON.parse(xhr.responseText);
                } catch(e) {
                    gsUtils.error('background', 'Failed to parse notice response', xhr.responseText);
                    return;
                }

                if (!resp || !resp.active || !resp.text) {
                    return;
                }

                //only show notice if it is intended for this version and it has not already been shown
                var currentNoticeVersion = String(resp.version);
                if (resp.target === chrome.runtime.getManifest().version &&
                    currentNoticeVersion > lastNoticeVersion) {

                    //set global notice field (so that it can be trigger to show later)
                    noticeToDisplay = resp;
                }
            }
        };
        xhr.send();
    }

    function requestNotice() {
        return noticeToDisplay;
    }
    function clearNotice() {
        noticeToDisplay = undefined;
    }

    function requestDebugInfo(tabId, callback) {
        var info = {
            windowId: '',
            tabId: '',
            status: 'unknown',
            timerUp: '-'
        };

        chrome.tabs.get(tabId, function (tab) {

            if (chrome.runtime.lastError) {
                gsUtils.error(tabId, chrome.runtime.lastError.message);
                callback(info);

            } else {

                info.windowId = tab.windowId;
                info.tabId = tab.id;
                if(gsUtils.isNormalTab(tab)) {
                    gsMessages.sendRequestInfoToContentScript(tab.id, false, function (err, tabInfo) {
                        if (tabInfo) {
                            info.timerUp = tabInfo.timerUp;
                            calculateTabStatus(tab, tabInfo.status, function (status) {
                                info.status = status;
                                callback(info);
                            });
                        } else {
                            info.status = 'unknown';
                            callback(info);
                        }
                    });
                } else {
                    calculateTabStatus(tab, null, function (status) {
                        info.status = status;
                        callback(info);
                    });
                }
            }
        });
    }

    function getContentScriptStatus(tabId, knownContentScriptStatus) {
        return new Promise(function (resolve) {
            if (knownContentScriptStatus) {
                resolve(knownContentScriptStatus);
            } else {
                gsMessages.sendRequestInfoToContentScript(tabId, false, function (err, tabInfo) {
                    if (tabInfo) {
                        resolve(tabInfo.status);
                    } else {
                        resolve(null);
                    }
                });
            }
        });
    }

    //possible suspension states are:
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
    function calculateTabStatus(tab, knownContentScriptStatus, callback) {
        //check if it is a special tab
        if (gsUtils.isSpecialTab(tab)) {
            callback('special');
            return;
        }
        //check if tab has been discarded
        if (gsUtils.isDiscardedTab(tab)) {
            callback('discarded');
            return;
        }
        //check if it has already been suspended
        if (gsUtils.isSuspendedTab(tab)) {
            callback('suspended');
            return;
        }
        //check whitelist
        if (gsUtils.checkWhiteList(tab.url)) {
            callback('whitelisted');
            return;
        }
        //check never suspend
        //should come after whitelist check as it causes popup to show the whitelisting option
        if (gsStorage.getOption(gsStorage.SUSPEND_TIME) === '0') {
            callback('never');
            return;
        }
        getContentScriptStatus(tab.id, knownContentScriptStatus).then(function (contentScriptStatus) {
            if (contentScriptStatus && contentScriptStatus !== 'normal') {
                callback(contentScriptStatus);
                return;
            }
            //check running on battery
            if (gsStorage.getOption(gsStorage.BATTERY_CHECK) && chargingMode) {
                callback('charging');
                return;
            }
            //check internet connectivity
            if (gsStorage.getOption(gsStorage.ONLINE_CHECK) && !navigator.onLine) {
                callback('noConnectivity');
                return;
            }
            //check pinned tab
            if (gsUtils.isPinnedTab(tab)) {
                callback('pinned');
                return;
            }
            //check audible tab
            if (gsUtils.isAudibleTab(tab)) {
                callback('audible');
                return;
            }
            if (contentScriptStatus) {
                callback(contentScriptStatus); // should be 'normal'
                return;
            }
            callback('unknown');
        });
    }

    function getActiveTabStatus(callback) {
        getCurrentlyActiveTab(function (tab) {
            if (!tab) {
                callback('unknown');
                return;
            }
            calculateTabStatus(tab, null, function (status) {
                callback(status);
            });
        });
    }

    //change the icon to either active or inactive
    function setIconStatus(status) {
        var icon = status !== 'normal' ? suspensionPausedIcon : suspensionActiveIcon;
        chrome.browserAction.setIcon({ path: icon, tabId: globalCurrentTabId }, function () {
            if (chrome.runtime.lastError) {
                gsUtils.error('background', chrome.runtime.lastError.message);
            }
        });
    }

    //HANDLERS FOR RIGHT-CLICK CONTEXT MENU

    function buildContextMenu(showContextMenu) {

        var allContexts = ['page', 'frame', 'editable', 'image', 'video', 'audio']; //'selection',

        if (!showContextMenu) {
            chrome.contextMenus.removeAll();

        } else {

            chrome.contextMenus.create({
                title: chrome.i18n.getMessage('js_background_open_link_in_suspended_tab'),
                contexts: ['link'],
                onclick: function (info, tab) {
                    openLinkInSuspendedTab(tab, info.linkUrl);
                }
            });

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
    }

    //HANDLERS FOR KEYBOARD SHORTCUTS

    chrome.commands.onCommand.addListener(function (command) {
        if (command === '1-suspend-tab') {
            toggleSuspendedStateOfHighlightedTab();

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

    //HANDLERS FOR CONTENT SCRIPT MESSAGE REQUESTS

    function contentScriptMessageRequestListener(request, sender, sendResponse) {
        gsUtils.log(sender.tab.id, 'contentScriptMessageRequestListener', request.action);

        switch (request.action) {

        // Can be send either via a content script or suspended tab
        case 'reportTabState':
            // If tab is currently visible then update popup icon
            if (sender.tab && sender.tab.id === globalCurrentTabId) {
                var contentScriptStatus = (request && request.status) ? request.status : null;
                calculateTabStatus(sender.tab, contentScriptStatus, function (status) {
                    setIconStatus(status);
                });
            }
            break;

        case 'suspendTab':
            attemptTabSuspension(sender.tab, 3);
            break;

        }
        sendResponse();
        return false;
    }

    //attach listener to runtime
    chrome.runtime.onMessage.addListener(contentScriptMessageRequestListener);
    //attach listener to runtime for external messages, to allow
    //interoperability with other extensions in the manner of an API
    chrome.runtime.onMessageExternal.addListener(contentScriptMessageRequestListener);

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
        clearTabFlagsForTabId(tabId);
        chrome.windows.getCurrent({}, function (currentWindow) {
            lastSelectedTabByWindowId[currentWindow.id] = null;
        });
    });
    chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {

        if (!changeInfo) return;
        // gsUtils.log(tabId, 'tab updated.', changeInfo);
        gsUtils.log(tabId, 'tab updated. tabUrl: ' + tab.url);

        //test for special case of a successful donation
        if (changeInfo.url && changeInfo.url === 'https://greatsuspender.github.io/thanks.html') {
            if (!gsStorage.getOption(gsStorage.NO_NAG)) {
                gsStorage.setOption(gsStorage.NO_NAG, true);
                // resuspendAllSuspendedTabs();
            }
            chrome.tabs.update(tabId, { url: chrome.extension.getURL('thanks.html') });
            return;
        }

        //only save session if the tab url has changed
        if (changeInfo.url) {
            queueSessionTimer();
        }

        if (gsUtils.isSuspendedTab(tab, true)) {
            handleSuspendedTabChanged(tab, changeInfo);
        }
        else if (gsUtils.isNormalTab(tab)) {
            handleUnsuspendedTabChanged(tab, changeInfo);
        }
    });
    chrome.windows.onCreated.addListener(function () {
        queueSessionTimer();

        if (requestNotice()) {
            chrome.tabs.create({url: chrome.extension.getURL('notice.html')});
        }
    });
    chrome.windows.onRemoved.addListener(function () {
        queueSessionTimer();
    });

    //tidy up history items as they are created
    chrome.history.onVisited.addListener(function (historyItem) {

        var url = historyItem.url;

        if (gsUtils.isSuspendedUrl(url, true)) {
            url = gsUtils.getSuspendedUrl(url);

            //remove suspended tab history item
            chrome.history.deleteUrl({url: historyItem.url});
            chrome.history.addUrl({url: url}, function () {
                if (chrome.runtime.lastError) {
                    gsUtils.error('background', chrome.runtime.lastError.message);
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
                getActiveTabStatus(function (status) {
                    setIconStatus(status);
                });
            };
        });
    }

    //add listeners for online/offline state changes
    window.addEventListener('online', function () {
        getActiveTabStatus(function (status) {
            setIconStatus(status);
        });
    });
    window.addEventListener('offline', function () {
        getActiveTabStatus(function (status) {
            setIconStatus(status);
        });
    });

    //start job to check for notices (twice a day)
    var noticeCheckInterval = 1000 * 60 * 60 * 12;
    checkForNotices();
    window.setInterval(checkForNotices, noticeCheckInterval);

    return {

        TEMP_WHITELIST_ON_RELOAD: TEMP_WHITELIST_ON_RELOAD,
        UNSUSPEND_ON_RELOAD: UNSUSPEND_ON_RELOAD,
        SCROLL_POS: SCROLL_POS,
        CREATE_TIMESTAMP: CREATE_TIMESTAMP,
        getTabFlagForTabId: getTabFlagForTabId,
        setTabFlagForTabId: setTabFlagForTabId,

        init: init,
        requestNotice: requestNotice,
        clearNotice: clearNotice,
        buildContextMenu: buildContextMenu,
        resuspendAllSuspendedTabs: resuspendAllSuspendedTabs,
        resuspendSuspendedTab: resuspendSuspendedTab,
        requestActiveTabStatus: getActiveTabStatus,
        requestDebugInfo: requestDebugInfo,
        setRecoveryMode: setRecoveryMode,

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
        unsuspendAllTabsInAllWindows: unsuspendAllTabsInAllWindows,
    };

}());
