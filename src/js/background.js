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

    var lastSelectedTabByWindowId = {},
        spawnedTabCreateTimestampByTabId = {},
        globalCurrentTabId,
        sessionSaveTimer,
        noticeToDisplay,
        chargingMode = false,
        unsuspendOnReloadByTabId = {},
        temporaryWhitelistOnReloadByTabId = {},
        scrollPosByTabId = {},
        suspensionActiveIcon = '/img/icon19.png',
        suspensionPausedIcon = '/img/icon19b.png';

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

            //clear any outstanding tab requests
            delete unsuspendOnReloadByTabId[tab.id];
            delete temporaryWhitelistOnReloadByTabId[tab.id];

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
                            gsUtils.log('Error from content script from tabId ' + tab.id + ': ' + response.errorMsg);
                        }
                        if (response.timerMsg) {
                            gsUtils.log('Time taken to generate preview for tabId ' + tab.id + ': ' + response.timerMsg);
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
                }
            }
        });
    }

    function unwhitelistHighlightedTab() {
        getCurrentlyActiveTab(function (activeTab) {
            if (activeTab) {
                gsUtils.removeFromWhitelist(activeTab.url);
            }
        });
    }

    function temporarilyWhitelistHighlightedTab() {
        getCurrentlyActiveTab(function (activeTab) {
            if (activeTab) {
                gsMessages.sendTemporaryWhitelistToContentScript(activeTab.id);
            }
        });
    }

    function undoTemporarilyWhitelistHighlightedTab() {
        getCurrentlyActiveTab(function (activeTab) {
            if (activeTab) {
                gsMessages.sendUndoTemporaryWhitelistToContentScript(activeTab.id);
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
                spawnedTabCreateTimestampByTabId[tab.id] = Date.now();
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
                    else {
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
                    else {
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
        gsMessages.sendUnsuspendOnReloadValueToSuspendedTab(tab.id, false, function (err) {
            if (!err) chrome.tabs.reload(tab.id);
        });
    }

    function queueSessionTimer() {
        clearTimeout(sessionSaveTimer);
        sessionSaveTimer = setTimeout(function () {
            gsUtils.log('savingWindowHistory');
            saveWindowHistory();
        }, 1000);
    }

    function saveWindowHistory() {
        chrome.windows.getAll({populate: true}, function (windows) {
            //uses global sessionId
            gsUtils.saveWindowsToSessionHistory(gsSession.getSessionId(), windows);
        });
    }

    function unsuspendTab(tab) {
        if (!gsUtils.isSuspendedTab(tab)) return;

        var url = gsUtils.getSuspendedUrl(tab.url),
            scrollPosition = gsUtils.getSuspendedScrollPosition(tab.url);

        scrollPosByTabId[tab.id] = scrollPosition || scrollPosByTabId[tab.id];

        //bit of a hack here as using the chrome.tabs.update method will not allow
        //me to 'replace' the url - leaving a suspended tab in the history
            gsMessages.sendUnsuspendRequestToSuspendedTab(tab.id, function (err) {

            //if we failed to find the tab with the above method then try to reload the tab directly
            if (err && url) {
                gsUtils.log('Will reload directly.');
                chrome.tabs.update(tab.id, {url: url});
            }
        });
    }

    function handleWindowFocusChanged(windowId) {
        if (windowId < 0) {
            return;
        }
        gsUtils.log('window changed:', windowId);
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

        gsUtils.log('tab changed:', tabId);
        var lastSelectedTab = lastSelectedTabByWindowId[windowId];

        lastSelectedTabByWindowId[windowId] = tabId;
        globalCurrentTabId = tabId;

        //reset timer on tab that lost focus
        //TODO: ideally we'd only reset timer on last tab viewed for more than 500ms (as per setTimeout below)
        //but that's getting tricky to determine
        if (lastSelectedTab) {
            gsMessages.sendRestartTimerToContentScript(lastSelectedTab);
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
        var unsuspend = gsStorage.getOption(gsStorage.UNSUSPEND_ON_FOCUS);

        //optimisation to prevent a chrome.tabs.get call
        if (unsuspend) {

            //get tab object so we can check if it is a suspended tab
            chrome.tabs.get(tabId, function (tab) {
                if (chrome.runtime.lastError) {
                    gsUtils.error(chrome.runtime.lastError.message);
                    return;
                }
                if (gsUtils.isSuspendedTab(tab, true)) {

                    if (navigator.onLine) {
                        unsuspendTab(tab);
                    } else {
                        gsMessages.sendNoConnectivityMessageToSuspendedTab(tab.id);
                    }
                }
            });
        }

        //remove request to instantly suspend this tab id
        delete spawnedTabCreateTimestampByTabId[tabId];

        //clear timer on newly focused tab
        //NOTE: only works if tab is currently unsuspended
        gsMessages.sendClearTimerToContentScript(tabId);
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
                    gsUtils.error('Failed to parse notice response', xhr.responseText);
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
                gsUtils.error(chrome.runtime.lastError.message);
                callback(info);

            } else {

                info.windowId = tab.windowId;
                info.tabId = tab.id;

                //check if it is a special tab
                if (gsUtils.isSpecialTab(tab)) {
                    info.status = 'special';
                    callback(info);

                //check if tab has been discarded
                } else if (gsUtils.isDiscardedTab(tab)) {
                    info.status = 'discarded';
                    callback(info);

                //check if it has already been suspended
                } else if (gsUtils.isSuspendedTab(tab)) {
                    info.status = 'suspended';
                    callback(info);

                //request tab state and timer state from the content script
                } else {
                    gsMessages.sendRequestInfoToContentScript(tab.id, function (err, tabInfo) {
                        if (tabInfo) {
                            info.status = processActiveTabStatus(tab, tabInfo.status);
                            info.timerUp = tabInfo.timerUp;
                        } else {
                            info.status = processActiveTabStatus(tab, 'unknown');
                        }
                        callback(info);
                    });

                }
            }
        });
    }

    function processActiveTabStatus(tab, tabStatusString) {

        var suspendTime = gsStorage.getOption(gsStorage.SUSPEND_TIME),
            onlySuspendOnBattery = gsStorage.getOption(gsStorage.BATTERY_CHECK),
            onlySuspendWithInternet = gsStorage.getOption(gsStorage.ONLINE_CHECK);

        var status = tabStatusString;

        //check whitelist (ignore contentScriptStatus)
        if (gsUtils.checkWhiteList(tab.url)) {
            status = 'whitelisted';

        //check never suspend (ignore contentScriptStatus)
        //should come after whitelist check as it causes popup to show the whitelisting option
        } else if (suspendTime === '0') {
            status = 'never';

        //check running on battery
        } else if (tabStatusString === 'normal' && onlySuspendOnBattery && chargingMode) {
            status = 'charging';

        //check internet connectivity
        } else if (tabStatusString === 'normal' && onlySuspendWithInternet && !navigator.onLine) {
            status = 'noConnectivity';

        //check pinned tab
        } else if (tabStatusString === 'normal' && gsUtils.isPinnedTab(tab)) {
            status = 'pinned';

        //check audible tab
        } else if (tabStatusString === 'normal' && gsUtils.isAudibleTab(tab)) {
            status = 'audible';
        }
        return status;
    }

    //change the icon to either active or inactive
    function updateIcon(status) {
        var icon = status !== 'normal' ? suspensionPausedIcon : suspensionActiveIcon;
        chrome.browserAction.setIcon({ path: icon, tabId: globalCurrentTabId }, function () {
            if (chrome.runtime.lastError) {
                gsUtils.error(chrome.runtime.lastError.message);
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

    //HANDLERS FOR MESSAGE REQUESTS

    function messageRequestListener(request, sender, sendResponse) {
        gsUtils.log('listener fired:', request.action);
        gsUtils.dir(sender);

        switch (request.action) {

        // Can be send either via a content script or suspended tab
        case 'reportTabState':
            // If tab is currently visible then update popup icon
            if (sender.tab && sender.tab.id === globalCurrentTabId) {
                updateIcon(processActiveTabStatus(sender.tab, request.status));
            }
            break;

        case 'suspendTab':
            attemptTabSuspension(sender.tab, 3);
            break;

        case 'requestUnsuspendTab':
            if (sender.tab && gsUtils.isSuspendedTab(sender.tab)) {
                if (request.addToTemporaryWhitelist) {
                    temporaryWhitelistOnReloadByTabId[sender.tab.id] = true;
                }
                unsuspendTab(sender.tab);
            }
            break;

        case 'requestUnsuspendOnReload':
            if (sender.tab && gsUtils.isSuspendedTab(sender.tab)) {
                unsuspendOnReloadByTabId[sender.tab.id] = true;
            }
            break;
        }
        sendResponse();
        return false;
    }

    //attach listener to runtime
    chrome.runtime.onMessage.addListener(messageRequestListener);
    //attach listener to runtime for external messages, to allow
    //interoperability with other extensions in the manner of an API
    chrome.runtime.onMessageExternal.addListener(messageRequestListener);

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
        delete spawnedTabCreateTimestampByTabId[tabId];
    });
    chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {

        if (!changeInfo) return;
        gsUtils.log('tab updated. tabId: ', tabId, changeInfo);

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

        //check for change in tabs audible status
        if (changeInfo.hasOwnProperty('audible')) {

            //reset tab timer if tab has just finished playing audio
            if (!changeInfo.audible && gsStorage.getOption(gsStorage.IGNORE_AUDIO)) {
                gsMessages.sendRestartTimerToContentScript(tab.id);
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

        if (gsUtils.isSuspendedTab(tab)) {
            //reload if tab does not have an unsuspend request. only permit unsuspend if tab is being reloaded
            if (changeInfo.status === 'loading') {
                if (unsuspendOnReloadByTabId[tabId]) {
                    unsuspendTab(tab);
                }
                delete unsuspendOnReloadByTabId[tabId];

            } else if (changeInfo.status === 'complete') {
                //set the setUnsuspendOnReload to true
                gsMessages.sendUnsuspendOnReloadValueToSuspendedTab(tabId, true);

                //remove request to instantly suspend this tab id
                delete spawnedTabCreateTimestampByTabId[tabId];

                if (tabId === globalCurrentTabId) {
                    updateIcon('suspended');
                }
            }

        } else {
            if (changeInfo.status === 'complete') {
                var spawnedTabCreateTimestamp = spawnedTabCreateTimestampByTabId[tab.id];
                //safety check that only allows tab to auto suspend if it has been less than 300 seconds since spawned tab created
                if (spawnedTabCreateTimestamp && ((Date.now() - spawnedTabCreateTimestamp) / 1000 < 300)) {
                    attemptTabSuspension(tab, 1);
                //init loaded tab
                } else {
                    var ignoreForms = gsStorage.getOption(gsStorage.IGNORE_FORMS);
                    var isTempWhitelist = temporaryWhitelistOnReloadByTabId[tab.id];
                    var scrollPos = scrollPosByTabId[tab.id] || null;
                    var suspendTime = tab.active ? null : gsStorage.getOption(gsStorage.SUSPEND_TIME);
                    delete temporaryWhitelistOnReloadByTabId[tab.id];
                    delete scrollPosByTabId[tab.id];
                    gsMessages.sendInitTabToContentScript(tab.id, ignoreForms, isTempWhitelist, scrollPos, suspendTime);

                    // If tab is currently visible then update popup icon
                    if (tab.id === globalCurrentTabId) {
                        var contentScriptState = isTempWhitelist ? 'tempWhitelist' : 'normal';
                        updateIcon(processActiveTabStatus(tab, contentScriptState));
                    }
                }
            }
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
                    gsUtils.error(chrome.runtime.lastError.message);
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

    //start job to check for notices (twice a day)
    var noticeCheckInterval = 1000 * 60 * 60 * 12;
    checkForNotices();
    window.setInterval(checkForNotices, noticeCheckInterval);

    return {
        init: init,
        requestNotice: requestNotice,
        clearNotice: clearNotice,
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
        unsuspendAllTabsInAllWindows: unsuspendAllTabsInAllWindows,
    };

}());
