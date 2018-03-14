/* global gsStorage, gsUtils, gsSession, gsMessages, gsSuspendManager, chrome, XMLHttpRequest */
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
    var SPAWNED_TAB_CREATE_TIMESTAMP = 'spawnedTabCreateTimestamp';
    var FOCUS_DELAY = 500;

    var lastFocusedTabByWindowId = {},
        lastFocusedWindowId,
        sessionSaveTimer,
        newTabFocusTimer,
        newWindowFocusTimer,
        noticeToDisplay,
        chargingMode = false,
        suspensionActiveIcon = '/img/icon19.png',
        suspensionPausedIcon = '/img/icon19b.png',
        suspendUnsuspendHotkey;

    var tabFlagsByTabId = {};


    function init() {

        //initialise lastFocusedWindowId and lastFocusedTabByWindowId
        getCurrentlyActiveTab(function (activeTab) {
            if (activeTab) {
                lastFocusedWindowId = activeTab.windowId;
                lastFocusedTabByWindowId[activeTab.windowId] = activeTab;
            }
        });
    }

    function getCurrentlyActiveTab(callback) {
        chrome.tabs.query({active: true, currentWindow: true}, function (tabs) {
            if (tabs.length > 0) {
                callback(tabs[0]);
            }
            else {
                //TODO: Possibly fallback on lastFocusedWindowId and lastFocusedTabByWindowId here?
                //except during initialization!!
                //see https://github.com/deanoemcke/thegreatsuspender/issues/574
                callback(null);
            }
        });
    }

    // NOTE: Focused here means has had focus for more than FOCUS_DELAY ms
    // So it may not necessarily have the tab.active flag set to true
    function isCurrentlyFocusedTab(tab) {
        if (tab.windowId !== lastFocusedWindowId) {
            return false;
        }
        var lastFocusedTabForWindow = lastFocusedTabByWindowId[tab.windowId];
        if (lastFocusedTabForWindow) {
            return tab.id === lastFocusedTabForWindow.id;
        } else {
            // fallback on active flag
            return tab.active;
        }
    }

    function whitelistHighlightedTab() {
        getCurrentlyActiveTab(function (activeTab) {
            if (activeTab) {
                gsUtils.saveRootUrlToWhitelist(activeTab.url);
                if (gsUtils.isSuspendedTab(activeTab)) {
                    unsuspendTab(activeTab);
                } else {
                    calculateTabStatus(activeTab, null, function (status) {
                        setIconStatus(status, activeTab.id);
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
                    setIconStatus(status, activeTab.id);
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
                        setIconStatus(status, activeTab.id);
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
                        setIconStatus(status, activeTab.id);
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
                setTabFlagForTabId(tab.id, SPAWNED_TAB_CREATE_TIMESTAMP,  Date.now());
            });
        });
    }

    function toggleSuspendedStateOfHighlightedTab() {
        getCurrentlyActiveTab(function (activeTab) {
            if (activeTab) {
                if (gsUtils.isSuspendedTab(activeTab)) {
                    unsuspendTab(activeTab);
                } else {
                    gsSuspendManager.queueTabForSuspension(activeTab, 1);
                }
            }
        });
    }

    function suspendHighlightedTab() {
        getCurrentlyActiveTab(function (activeTab) {
            if (activeTab) {
                gsSuspendManager.queueTabForSuspension(activeTab, 1);
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
                    gsSuspendManager.queueTabForSuspension(tab, 2);
                });
            });
        });
    }

    function suspendAllTabsInAllWindows() {
        chrome.tabs.query({}, function (tabs) {
            tabs.forEach(function (currentTab) {
                gsSuspendManager.queueTabForSuspension(currentTab, 1);
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
                gsSuspendManager.queueTabForSuspension(tab, 1);
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
            var tabsExist = windows.some((window) => window.tabs && window.tabs.length);
            if (tabsExist) {
                //uses global sessionId
                gsUtils.saveWindowsToSessionHistory(gsSession.getSessionId(), windows);
            }
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

    function getSuspendUnsuspendHotkey(callback) {
        if (suspendUnsuspendHotkey) {
            callback(suspendUnsuspendHotkey);
            return;
        }
        resetSuspendUnsuspendHotkey(function (hotkeyChanged) {
            callback(suspendUnsuspendHotkey);
        });
    }

    function resetSuspendUnsuspendHotkey(callback) {
        gsUtils.buildSuspendUnsuspendHotkey(function (_suspendUnsuspendHotkey) {
            var hotkeyChanged = _suspendUnsuspendHotkey !== suspendUnsuspendHotkey;
            suspendUnsuspendHotkey = _suspendUnsuspendHotkey;
            callback(hotkeyChanged);
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
            var spawnedTabCreateTimestamp = getTabFlagForTabId(tab.id, SPAWNED_TAB_CREATE_TIMESTAMP);
            //safety check that only allows tab to auto suspend if it has been less than 300 seconds since spawned tab created
            if (spawnedTabCreateTimestamp && ((Date.now() - spawnedTabCreateTimestamp) / 1000 < 300)) {
                gsSuspendManager.queueTabForSuspension(tab, 1);
                return;
            }

            //init loaded tab
            initialiseUnsuspendedTab(tab);
            clearTabFlagsForTabId(tab.id);
            hasTabStatusChanged = true;

            if (gsSession.isRecoveryMode()) {
                gsSession.handleTabRecovered(tab);
            }
        }

        //if tab is currently visible then update popup icon
        if (hasTabStatusChanged && isCurrentlyFocusedTab(tab)) {
            calculateTabStatus(tab, null, function (status) {
                setIconStatus(status, tab.id);
            });
        }
    }

    function initialiseUnsuspendedTab(tab, callback) {
        var ignoreForms = gsStorage.getOption(gsStorage.IGNORE_FORMS);
        var isTempWhitelist = getTabFlagForTabId(tab.id, TEMP_WHITELIST_ON_RELOAD);
        var scrollPos = getTabFlagForTabId(tab.id, SCROLL_POS) || null;
        var suspendTime = gsUtils.isActiveTab(tab) ? 0 : gsStorage.getOption(gsStorage.SUSPEND_TIME);
        gsMessages.sendInitTabToContentScript(tab.id, ignoreForms, isTempWhitelist, scrollPos, suspendTime, callback);
    }

    function handleSuspendedTabChanged(tab, changeInfo) {
        //if a suspended tab is being reloaded, we may want to actually unsuspend it instead
        //if the UNSUSPEND_ON_RELOAD flag is true, then unsuspend.
        if (changeInfo.status === 'loading') {
            var unsuspendOnReload = getTabFlagForTabId(tab.id, UNSUSPEND_ON_RELOAD);
            if (unsuspendOnReload) {
                unsuspendTab(tab);
            }
            setTabFlagForTabId(tab.id, UNSUSPEND_ON_RELOAD, false);

        } else if (changeInfo.status === 'complete') {
            initialiseSuspendedTab(tab);
            clearTabFlagsForTabId(tab.id);
            gsSuspendManager.markTabAsSuspended(tab);

            if (isCurrentlyFocusedTab(tab)) {
                setIconStatus('suspended', tab.id);
            }

            if (gsSession.isRecoveryMode()) {
                gsSession.handleTabRecovered(tab);
            }
        }
    }

    function initialiseSuspendedTab(tab, callback) {

        var suspendedUrl = tab.url;
        var originalUrl = gsUtils.getSuspendedUrl(suspendedUrl);
        var scrollPosition = gsUtils.getSuspendedScrollPosition(suspendedUrl);
        var whitelisted = gsUtils.checkWhiteList(originalUrl);
        gsStorage.fetchTabInfo(originalUrl).then(function (tabProperties) {
            var favicon = tabProperties && tabProperties.favicon || 'chrome://favicon/' + originalUrl;
            var title = tabProperties && tabProperties.title || gsUtils.getSuspendedTitle(suspendedUrl);
            if (title.indexOf('<') >= 0) {
                // Encode any raw html tags that might be used in the title
                title = gsUtils.htmlEncode(title);
            }
            gsStorage.fetchPreviewImage(originalUrl, function (preview) {
                var previewUri = null;
                if (preview && preview.img && preview.img !== null && preview.img !== 'data:,' && preview.img.length > 10000) {
                    previewUri = preview.img;
                }
                var options = gsStorage.getSettings();
                getSuspendUnsuspendHotkey(function (suspendUnsuspendHotkey) {
                    var payload = {
                        tabId: tab.id,
                        requestUnsuspendOnReload: true,
                        url: originalUrl,
                        scrollPosition: scrollPosition,
                        favicon: favicon,
                        title: title,
                        whitelisted: whitelisted,
                        theme: options[gsStorage.THEME],
                        hideNag: options[gsStorage.NO_NAG],
                        previewMode: options[gsStorage.SCREEN_CAPTURE],
                        previewUri: previewUri,
                        command: suspendUnsuspendHotkey,
                    };
                    gsMessages.sendInitSuspendedTab(tab.id, payload, callback);
                });
            });
        });
    }

    function handleWindowFocusChanged(windowId) {
        if (windowId < 0) {
            return;
        }
        gsUtils.log(windowId, 'window changed');
        // Get the active tab in the newly focused window
        chrome.tabs.query({active: true}, function (tabs) {
            if (!tabs || !tabs.length) {
                return;
            }
            var newTab;
            var lastFocusedTab;
            for (var tab of tabs) {
                if (tab.windowId === windowId) {
                    newTab = tab;
                }
                if (isCurrentlyFocusedTab(tab)) {
                    lastFocusedTab = tab;
                }
            }
            if (!newTab) {
                gsUtils.error('background', 'Couldnt find active tab with windowId: ' + windowId);
                return;
            }

            //update icon
            calculateTabStatus(newTab, null, function (status) {
                setIconStatus(status, newTab.id);
            });

            //pause for a bit before assuming we're on a new window as some users
            //will key through intermediate windows to get to the one they want.
            queueNewWindowFocusTimer(newTab.id, lastFocusedTab, newTab);
        });

    }

    function handleTabFocusChanged(tabId, windowId) {
        gsUtils.log(tabId, 'tab gained focus');

        chrome.tabs.get(tabId, function (tab) {
            if (chrome.runtime.lastError) {
                gsUtils.error(tabId, chrome.runtime.lastError);
                return;
            }

            //update icon
            calculateTabStatus(tab, null, function (status) {
                setIconStatus(status, tab.id);
            });

            //pause for a bit before assuming we're on a new tab as some users
            //will key through intermediate tabs to get to the one they want.
            queueNewTabFocusTimer(tabId, windowId, tab);
        });
    }

    function queueNewWindowFocusTimer(tabId, lastFocusedTab, newTab) {
        clearTimeout(newWindowFocusTimer);
        newWindowFocusTimer = setTimeout(function () {
            lastFocusedWindowId = newTab.windowId;
            handleNewTabFocus(tabId, lastFocusedTab, newTab);
        }, FOCUS_DELAY);
    }

    function queueNewTabFocusTimer(tabId, windowId, newTab) {
        clearTimeout(newTabFocusTimer);
        newTabFocusTimer = setTimeout(function () {
            var lastFocusedTab = lastFocusedTabByWindowId[windowId];
            lastFocusedTabByWindowId[windowId] = newTab;
            handleNewTabFocus(tabId, lastFocusedTab, newTab);
        }, FOCUS_DELAY);
    }

    function handleNewTabFocus(tabId, lastFocusedTab, newTab) {
        gsUtils.log(tabId, 'new tab focus handled');
        //remove request to instantly suspend this tab id
        if (getTabFlagForTabId(tabId, SPAWNED_TAB_CREATE_TIMESTAMP)) {
            setTabFlagForTabId(tabId, SPAWNED_TAB_CREATE_TIMESTAMP, false);
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
            if (newTab.status === 'complete') {
                gsMessages.sendClearTimerToContentScript(tabId);
            }

            //if tab is already in the queue for suspension then remove it
            gsSuspendManager.unqueueTabForSuspension(newTab);

        } else if (newTab.url === chrome.extension.getURL('options.html')) {
            gsMessages.sendReloadOptionsToOptionsTab(newTab.id);
        }

        //Reset timer on tab that lost focus.
        //NOTE: This may be due to a change in window focus in which case the tab may still have .active = true
        if (lastFocusedTab && lastFocusedTab.id !== tabId) {
            chrome.tabs.get(lastFocusedTab.id, function (lastFocusedTab) {
                if (chrome.runtime.lastError) {
                    //Tab has probably been removed
                    return;
                }
                if (lastFocusedTab && gsUtils.isNormalTab(lastFocusedTab) && !gsUtils.isActiveTab(lastFocusedTab)) {
                    gsMessages.sendRestartTimerToContentScript(lastFocusedTab.id);
                }
            });
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

    function isCharging() {
        return chargingMode;
    }

    function getDebugInfo(tabId, callback) {
        var info = {
            windowId: '',
            tabId: '',
            status: 'unknown',
            timerUp: '-'
        };

        chrome.tabs.get(tabId, function (tab) {

            if (chrome.runtime.lastError) {
                gsUtils.error(tabId, chrome.runtime.lastError);
                callback(info);

            } else {

                info.windowId = tab.windowId;
                info.tabId = tab.id;
                if(gsUtils.isNormalTab(tab)) {
                    gsMessages.sendRequestInfoToContentScript(tab.id, function (err, tabInfo) {
                        if (tabInfo) {
                            info.timerUp = tabInfo.timerUp;
                            calculateTabStatus(tab, tabInfo.status, function (status) {
                                info.status = status;
                                callback(info);
                            });
                        } else {
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
                gsMessages.sendRequestInfoToContentScript(tabId, function (err, tabInfo) {
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
    //loading: tab object has a state of 'loading'
    //normal: a tab that will be suspended
    //special: a tab that cannot be suspended
    //suspended: a tab that is suspended
    //discarded: a tab that has been discarded
    //never: suspension timer set to 'never suspend'
    //formInput: a tab that has a partially completed form (and IGNORE_FORMS is true)
    //audible: a tab that is playing audio (and IGNORE_AUDIO is true)
    //active: a tab that is active (and IGNORE_ACTIVE_TABS is true)
    //tempWhitelist: a tab that has been manually paused
    //pinned: a pinned tab (and IGNORE_PINNED is true)
    //whitelisted: a tab that has been whitelisted
    //charging: computer currently charging (and BATTERY_CHECK is true)
    //noConnectivity: internet currently offline (and ONLINE_CHECK is true)
    //unknown: an error detecting tab status
    function calculateTabStatus(tab, knownContentScriptStatus, callback) {
        //check for loading
        if (tab.status === 'loading') {
            callback('loading');
            return;
        }
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
            //check active
            if (gsUtils.isActiveTab(tab)) {
                callback('active');
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
    function setIconStatus(status, tabId) {
        var icon = !['normal', 'active'].includes(status) ? suspensionPausedIcon : suspensionActiveIcon;
        chrome.browserAction.setIcon({ path: icon, tabId: tabId }, function () {
            if (chrome.runtime.lastError) {
                gsUtils.error('background', chrome.runtime.lastError);
            }
        });
    }

    function setIconStatusForActiveTab() {
        getCurrentlyActiveTab(function (tab) {
            if (!tab) {
                return;
            }
            calculateTabStatus(tab, null, function (status) {
                setIconStatus(status, tab.id);
            });
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

        } else if (command === '1b-pause-tab') {
            temporarilyWhitelistHighlightedTab();

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

        case 'reportTabState':
            // If tab is currently visible then update popup icon
            if (sender.tab && isCurrentlyFocusedTab(sender.tab)) {
                var contentScriptStatus = (request && request.status) ? request.status : null;
                calculateTabStatus(sender.tab, contentScriptStatus, function (status) {
                    setIconStatus(status, sender.tab.id);
                });
            }
            break;

        case 'suspendTab':
            gsSuspendManager.queueTabForSuspension(sender.tab, 3);
            break;

        case 'savePreviewData':
            if (request.previewUrl) {
                gsStorage.addPreviewImage(sender.tab.url, request.previewUrl, function () {
                    gsSuspendManager.executeTabSuspension(sender.tab);
                });
            } else {
                gsUtils.log('savePreviewData reported an error: ' + request.errorMsg);
                gsSuspendManager.executeTabSuspension(sender.tab);
            }
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
        gsUtils.log(tab.id, 'tab created. tabUrl: ' + tab.url);
        queueSessionTimer();
    });
    chrome.tabs.onRemoved.addListener(function (tabId, removeInfo) {
        gsUtils.log(tabId, 'tab removed.');
        queueSessionTimer();
        clearTabFlagsForTabId(tabId);
    });
    chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
        if (!changeInfo) return;
        if (!changeInfo.url && !changeInfo.status && !changeInfo.audible && !changeInfo.pinned) return;
        // gsUtils.log(tabId, 'tab updated.', changeInfo);
        gsUtils.log(tabId, 'tab updated. tabUrl: ' + tab.url);

        // if url has changed
        if (changeInfo.url) {
            // test for special case of a successful donation
            if (changeInfo.url === 'https://greatsuspender.github.io/thanks.html') {
                if (!gsStorage.getOption(gsStorage.NO_NAG)) {
                    gsStorage.setOption(gsStorage.NO_NAG, true);
                }
                chrome.tabs.update(tabId, { url: chrome.extension.getURL('thanks.html') });
                return;
            // test for a save of keyboard shortcuts (chrome://extensions/configureCommands)
            } else if (changeInfo.url === 'chrome://extensions/') {
                resetSuspendUnsuspendHotkey(function (hotkeyChanged) {
                    if (hotkeyChanged) {
                        getSuspendUnsuspendHotkey(function (hotkey) {
                            gsMessages.sendRefreshToAllSuspendedTabs({
                                command: hotkey,
                            });
                        });
                    }
                });

            } else {
                queueSessionTimer();
            }
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
                    gsUtils.error('background', chrome.runtime.lastError);
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
                setIconStatusForActiveTab();
            };
        });
    }

    //add listeners for online/offline state changes
    window.addEventListener('online', function () {
        setIconStatusForActiveTab();
    });
    window.addEventListener('offline', function () {
        setIconStatusForActiveTab();
    });

    //start job to check for notices (twice a day)
    var noticeCheckInterval = 1000 * 60 * 60 * 12;
    checkForNotices();
    window.setInterval(checkForNotices, noticeCheckInterval);

    return {

        TEMP_WHITELIST_ON_RELOAD: TEMP_WHITELIST_ON_RELOAD,
        UNSUSPEND_ON_RELOAD: UNSUSPEND_ON_RELOAD,
        SCROLL_POS: SCROLL_POS,
        CREATE_TIMESTAMP: SPAWNED_TAB_CREATE_TIMESTAMP,
        getTabFlagForTabId: getTabFlagForTabId,
        setTabFlagForTabId: setTabFlagForTabId,

        init: init,
        requestNotice: requestNotice,
        clearNotice: clearNotice,
        buildContextMenu: buildContextMenu,
        resuspendSuspendedTab: resuspendSuspendedTab,
        getActiveTabStatus: getActiveTabStatus,
        getDebugInfo: getDebugInfo,
        isCharging: isCharging,
        isCurrentlyFocusedTab: isCurrentlyFocusedTab,

        initialiseUnsuspendedTab: initialiseUnsuspendedTab,
        initialiseSuspendedTab: initialiseSuspendedTab,
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
