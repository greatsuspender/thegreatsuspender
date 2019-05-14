/* global gsStorage, gsChrome, gsIndexedDb, gsTabActions, gsUtils, gsEvents, gsTabState, gsFavicon, gsSession, gsMessages, gsTabSelector, gsTabSuspendManager, gsTabDiscardManager, gsAnalytics, gsTabCheckManager, gsSuspendedTab, chrome, XMLHttpRequest */
/*
 * The Great Suspender
 * Copyright (C) 2017 Dean Oemcke
 * Available under GNU GENERAL PUBLIC LICENSE v2
 * http://github.com/deanoemcke/thegreatsuspender
 * ༼ つ ◕_◕ ༽つ
*/
var tgs = (function() {
  // eslint-disable-line no-unused-vars
  'use strict';

  const ICON_SUSPENSION_ACTIVE = {
    '16': 'img/ic_suspendy_16x16.png',
    '32': 'img/ic_suspendy_32x32.png',
  };
  const ICON_SUSPENSION_PAUSED = {
    '16': 'img/ic_suspendy_16x16_grey.png',
    '32': 'img/ic_suspendy_32x32_grey.png',
  };

  const focusDelay = 500;
  const noticeCheckInterval = 1000 * 60 * 60 * 12; // every 12 hours
  const sessionMetricsCheckInterval = 1000 * 60 * 15; // every 15 minutes
  const analyticsCheckInterval = 1000 * 60 * 60 * 23.5; // every 23.5 hours

  let _newTabFocusTimer;
  let _newWindowFocusTimer;
  let _noticeToDisplay;
  let _isCharging = false;
  let _triggerHotkeyUpdate = false;
  let _suspensionToggleHotkey;

  let _cmidSuspendToggle;
  let _cmidPauseToggle;

  function getExtensionGlobals() {
    const globals = {
      tgs,
      gsUtils,
      gsChrome,
      gsAnalytics,
      gsStorage,
      gsIndexedDb,
      gsMessages,
      gsSession,
      gsFavicon,
      gsTabState,
      gsEvents,
      gsTabSelector,
      gsTabActions,
      gsTabCheckManager,
      gsTabSuspendManager,
      gsTabDiscardManager,
      gsSuspendedTab,
    };
    for (const lib of Object.values(globals)) {
      if (!lib) {
        return null;
      }
    }
    return globals;
  }

  function setViewGlobals(_window) {
    const globals = getExtensionGlobals();
    if (!globals) {
      throw new Error('Lib not ready');
    }
    Object.assign(_window, globals);
  }

  function backgroundScriptsReadyAsPromised(retries) {
    retries = retries || 0;
    if (retries > 300) {
      // allow 30 seconds :scream:
      chrome.tabs.create({ url: chrome.extension.getURL('broken.html') });
      return Promise.reject('Failed to initialise background scripts');
    }
    return new Promise(function(resolve) {
      const isReady = getExtensionGlobals() !== null;
      resolve(isReady);
    }).then(function(isReady) {
      if (isReady) {
        return Promise.resolve();
      }
      return new Promise(function(resolve) {
        window.setTimeout(resolve, 100);
      }).then(function() {
        retries += 1;
        return backgroundScriptsReadyAsPromised(retries);
      });
    });
  }

  function initAsPromised() {
    return new Promise(async function(resolve) {
      gsUtils.log('background', 'PERFORMING BACKGROUND INIT...');

      //initialise unsuspended tab props
      resetAutoSuspendTimerForAllTabs();

      //add context menu items
      //TODO: Report chrome bug where adding context menu in incognito removes it from main windows
      if (!chrome.extension.inIncognitoContext) {
        buildContextMenu(false);
        var contextMenus = gsStorage.getOption(gsStorage.ADD_CONTEXT);
        buildContextMenu(contextMenus);
      }
      gsUtils.log('background', 'init successful');
      resolve();
    });
  }

  //make sure the contentscript / suspended script of each tab is responsive
  async function performTabChecks() {
    const initStartTime = Date.now();
    gsUtils.log(
      'background',
      '\n\n------------------------------------------------\n' +
        `Checking tabs for responsiveness..\n` +
        '------------------------------------------------\n\n'
    );

    const postRecoverySessionTabs = await gsChrome.tabsQuery();
    gsUtils.log(
      'background',
      'postRecoverySessionTabs:',
      postRecoverySessionTabs
    );

    for (const tab of postRecoverySessionTabs) {
      gsTabState.createNewTabState(tab);
    }

    const tabCheckResults = await gsTabCheckManager.performInitialisationTabChecks(
      postRecoverySessionTabs
    );
    const totalTabCheckCount = tabCheckResults.length;
    const successfulTabChecksCount = tabCheckResults.filter(
      o => o === gsUtils.STATUS_SUSPENDED || o === gsUtils.STATUS_DISCARDED
    ).length;

    const startupTabCheckTimeTakenInSeconds = parseInt(
      (Date.now() - initStartTime) / 1000
    );
    gsUtils.log(
      'background',
      '\n\n------------------------------------------------\n' +
        `Checking tabs finished. Time taken: ${startupTabCheckTimeTakenInSeconds} sec\n` +
        `${successfulTabChecksCount} / ${totalTabCheckCount} initialised successfully\n` +
        '------------------------------------------------\n\n'
    );
  }

  function startTimers() {
    startNoticeCheckerJob();
    startSessionMetricsJob();
    startAnalyticsUpdateJob();
  }

  function getInternalViewByTabId(tabId) {
    const internalViews = chrome.extension.getViews({ tabId: tabId });
    if (internalViews.length === 1) {
      return internalViews[0];
    }
    return null;
  }
  function getInternalViewsByViewName(viewName) {
    const internalViews = chrome.extension
      .getViews()
      .filter(o => o.location.pathname.indexOf(viewName) >= 0);
    return internalViews;
  }

  function openLinkInSuspendedTab(parentTab, linkedUrl) {
    //imitate chromes 'open link in new tab' behaviour in how it selects the correct index
    chrome.tabs.query({ windowId: chrome.windows.WINDOW_ID_CURRENT }, tabs => {
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
        active: false,
      };
      chrome.tabs.create(newTabProperties, tab => {
        gsTabSuspendManager.queueTabForSuspension(tab, 1);
      });
    });
  }

  function resetAutoSuspendTimerForTab(tab) {
    clearAutoSuspendTimerForTabId(tab.id);

    const suspendTime = gsStorage.getOption(gsStorage.SUSPEND_TIME);
    const timeToSuspend = suspendTime * (1000 * 60);
    if (
      gsUtils.isProtectedActiveTab(tab) ||
      isNaN(suspendTime) ||
      suspendTime <= 0
    ) {
      return;
    }

    const timerDetails = {};
    timerDetails.tabId = tab.id;
    timerDetails.suspendDateTime = new Date(
      new Date().getTime() + timeToSuspend
    );

    timerDetails.timer = setTimeout(async () => {
      const updatedTabId = timerDetails.tabId; // This may get updated via updateTabIdReferences
      const updatedTab = await gsChrome.tabsGet(updatedTabId);
      if (!updatedTab) {
        gsUtils.warning(updatedTabId, 'Couldnt find tab. Aborting suspension');
        return;
      }
      gsTabSuspendManager.queueTabForSuspension(updatedTab, 3);
    }, timeToSuspend);
    gsUtils.log(
      tab.id,
      'Adding tab timer for: ' + timerDetails.suspendDateTime
    );
    gsTabState.setTabTimer(tab.id, timerDetails);
  }

  function resetAutoSuspendTimerForAllTabs() {
    chrome.tabs.query({}, tabs => {
      for (const tab of tabs) {
        if (gsUtils.isNormalTab(tab)) {
          resetAutoSuspendTimerForTab(tab);
        }
      }
    });
  }

  function clearAutoSuspendTimerForTabId(tabId) {
    const timerDetails = gsTabState.getTabTimer(tabId);
    if (!timerDetails) {
      return;
    }
    gsUtils.log(tabId, 'Removing tab timer.');
    clearTimeout(timerDetails.timer);
    gsTabState.setTabTimer(tabId, null);
  }

  function buildSuspensionToggleHotkey() {
    return new Promise(resolve => {
      let printableHotkey = '';
      chrome.commands.getAll(commands => {
        const toggleCommand = commands.find(o => o.name === '1-suspend-tab');
        if (toggleCommand && toggleCommand.shortcut !== '') {
          printableHotkey = gsUtils.formatHotkeyString(toggleCommand.shortcut);
          resolve(printableHotkey);
        } else {
          resolve(null);
        }
      });
    });
  }

  function checkForTriggerUrls(tab, url) {
    // test for special case of a successful donation
    if (url.indexOf('greatsuspender.github.io/thanks.html') > 0) {
      gsStorage.setOptionAndSync(gsStorage.NO_NAG, true);
      gsAnalytics.reportEvent('Donations', 'HidePopupAuto', true);
      chrome.tabs.update(tab.id, {
        url: chrome.extension.getURL('thanks.html'),
      });

      // test for a save of keyboard shortcuts (chrome://extensions/shortcuts)
    } else if (url === 'chrome://extensions/shortcuts') {
      _triggerHotkeyUpdate = true;
    }
  }

  async function handleUnsuspendedTabStateChanged(tab, changeInfo) {
    if (
      !changeInfo.hasOwnProperty('status') &&
      !changeInfo.hasOwnProperty('audible') &&
      !changeInfo.hasOwnProperty('pinned') &&
      !changeInfo.hasOwnProperty('discarded')
    ) {
      return;
    }
    gsUtils.log(
      tab.id,
      'unsuspended tab state changed. changeInfo: ',
      changeInfo
    );

    // Ensure we clear the gsTabState.UNLOADED_URL flag during unsuspended tab
    // load in case the tab is suspended again before loading can finish (in
    // which case on suspended tab complete, the tab will reload again)
    if (
      changeInfo.hasOwnProperty('status') &&
      changeInfo.status === 'loading'
    ) {
      gsTabState.setTabUnloadedUrlFlag(tab.id, null);
    }

    // Check if tab has just been discarded
    if (changeInfo.hasOwnProperty('discarded') && changeInfo.discarded) {
      // When a tab is discarded the tab id changes. We need up-to-date UNSUSPENDED
      // tabIds in the current session otherwise crash recovery will not work
      gsSession.queueUpdateCurrentSession();
      return;
    }

    // Check if tab is queued for suspension
    const tabQueueState = gsTabSuspendManager.getTabQueueState(tab);
    if (tabQueueState) {
      // Requeue tab to wake it from possible sleep
      gsTabState.setPropForTabId(tab.id, 'refetchTab', false);
      gsTabSuspendManager.queueTabForSuspension(
        tab,
        tabQueueState.executionProps.forceLevel
      );
      return;
    }

    let hasTabStatusChanged = false;

    // Check for change in tabs audible status
    if (changeInfo.hasOwnProperty('audible')) {
      //reset tab timer if tab has just finished playing audio
      if (!changeInfo.audible && gsStorage.getOption(gsStorage.IGNORE_AUDIO)) {
        resetAutoSuspendTimerForTab(tab);
      }
      hasTabStatusChanged = true;
    }
    if (changeInfo.hasOwnProperty('pinned')) {
      //reset tab timer if tab has become unpinned
      if (!changeInfo.pinned && gsStorage.getOption(gsStorage.IGNORE_PINNED)) {
        resetAutoSuspendTimerForTab(tab);
      }
      hasTabStatusChanged = true;
    }

    if (changeInfo.hasOwnProperty('status')) {
      if (changeInfo.status === 'complete') {
        handleUnsuspendedTabLoaded(tab);
      }
      hasTabStatusChanged = true;
    }

    //if tab is currently visible then update popup icon
    if (hasTabStatusChanged && gsTabSelector.isCurrentFocusedTab(tab)) {
      await updateIconStatusForTab(tab);
    }
  }

  function handleUnsuspendedTabLoaded(tab) {
    const tempWhitelistOnReload = gsTabState.getTabTempWhitelistOnReloadFlag(
      tab.id
    );
    const scrollPos = gsTabState.getTabScrollPosFlag(tab.id) || null;
    const historyUrlToRemove = gsTabState.getTabHistoryUrlToRemoveFlag(tab.id);
    const isAutodiscardable = gsTabState.getTabIsAutoDiscardableFlag(tab.id);
    if (historyUrlToRemove) {
      removeTabHistoryForUnuspendedTab(historyUrlToRemove);
    }
    if (isAutodiscardable) {
      gsChrome.tabsUpdate(tab.id, { autoDiscardable: true });
    }

    //init loaded tab
    resetAutoSuspendTimerForTab(tab);
    initialiseTabContentScript(tab, tempWhitelistOnReload, scrollPos).catch(
      error => {
        gsUtils.warning(
          tab.id,
          'Failed to send init to content script. Tab may not behave as expected.'
        );
      }
    );

    gsTabState.setTabUnsuspended(tab.id);
  }

  function removeTabHistoryForUnuspendedTab(suspendedUrl) {
    chrome.history.deleteUrl({ url: suspendedUrl });
    const originalUrl = gsUtils.getOriginalUrl(suspendedUrl);
    chrome.history.getVisits({ url: originalUrl }, visits => {
      //assume history entry will be the second to latest one (latest one is the currently visible page)
      //NOTE: this will break if the same url has been visited by another tab more recently than the
      //suspended tab (pre suspension)
      //eslint-disable-next-line no-unused-vars
      const latestVisit = visits.pop();
      const previousVisit = visits.pop();
      if (previousVisit) {
        chrome.history.deleteRange(
          {
            startTime: previousVisit.visitTime - 0.1,
            endTime: previousVisit.visitTime + 0.1,
          },
          () => {}
        );
      }
    });
  }

  function initialiseTabContentScript(tab, isTempWhitelist, scrollPos) {
    return new Promise((resolve, reject) => {
      const ignoreForms = gsStorage.getOption(gsStorage.IGNORE_FORMS);
      gsMessages.sendInitTabToContentScript(
        tab.id,
        ignoreForms,
        isTempWhitelist,
        scrollPos,
        (error, response) => {
          if (error) {
            reject(error);
          } else {
            resolve(response);
          }
        }
      );
    });
  }

  function handleSuspendedTabStateChanged(tab, changeInfo) {
    if (
      !changeInfo.hasOwnProperty('status') &&
      !changeInfo.hasOwnProperty('discarded')
    ) {
      return;
    }

    gsUtils.log(
      tab.id,
      'suspended tab status changed. changeInfo: ',
      changeInfo
    );

    // Check if suspended tab has been reloaded with the same url.
    // If so, and the tab is not is a SUSPENDING state, unsuspend tab and return early
    const unloadedUrl = gsTabState.getTabUnloadedUrlFlag(tab.id);
    const suspendedTabReloaded = unloadedUrl === tab.url;
    if (suspendedTabReloaded && !gsTabState.isTabSuspending(tab.id)) {
      gsTabActions.unsuspendTab(tab); //async. unhandled promise
      return;
    }

    if (changeInfo.status && changeInfo.status === 'loading') {
      return;
    }

    // When suspended tabs are discarded (by chrome) also trigger initialisation
    if (
      (changeInfo.status && changeInfo.status === 'complete') ||
      (changeInfo.discarded && gsTabState.isTabSuspending(tab.id))
    ) {
      gsTabSuspendManager.unqueueTabForSuspension(tab); //safety precaution
      initialiseSuspendedTab(tab);
    }
  }

  function initialiseSuspendedTab(tab) {
    if (gsTabSelector.isCurrentFocusedTab(tab)) {
      setIconStatusForTabId(gsUtils.STATUS_SUSPENDED, tab.id);
    }

    //queue tab check before initTab as we want the check in the gsTabCheckManager
    //queue as early as possible. sometimes tabs will discard between now and the
    //end of initTab. if the tab is in the queue before this happens, it's tabId
    //will get updated when the discard triggers gsTabCheckManager.updateTabIdReferences
    gsTabCheckManager.queueTabCheck(tab, { refetchTab: true }, 3000);

    const tabView = tgs.getInternalViewByTabId(tab.id);
    const quickInit =
      gsStorage.getOption(gsStorage.DISCARD_AFTER_SUSPEND) && !tab.active;
    gsSuspendedTab
      .initTab(tab, tabView, { quickInit })
      .then(() => {

      })
      .catch(error => {
        gsUtils.warning(tab.id, error);
      });
  }

  async function getSuspensionToggleHotkey() {
    if (_suspensionToggleHotkey === undefined) {
      _suspensionToggleHotkey = await buildSuspensionToggleHotkey();
    }
    return _suspensionToggleHotkey;
  }

  async function handleWindowFocusChanged(windowId) {
    gsUtils.log(windowId, 'window gained focus');
    if (
      windowId < 0 ||
      windowId === gsTabSelector.getCurrentlyFocusedWindowId()
    ) {
      return;
    }
    gsTabSelector.setCurrentlyFocusedWindowId(windowId);
    checkForContextMenuChanges(); // async. unhandled promise

    // Get the active tab in the newly focused window
    const tabs = await gsChrome.tabsQuery({ active: true });
    if (!tabs || !tabs.length) {
      return;
    }
    var focusedTab;
    for (var tab of tabs) {
      if (tab.windowId === windowId) {
        focusedTab = tab;
      }
    }
    if (!focusedTab) {
      gsUtils.warning(
        'background',
        `Couldnt find active tab with windowId: ${windowId}. Window may have been closed.`
      );
      return;
    }

    //pause for a bit before assuming we're on a new window as some users
    //will key through intermediate windows to get to the one they want.
    queueNewWindowFocusTimer(focusedTab.id, windowId, focusedTab);

    //update icon
    await updateIconStatusForTab(tab);
  }

  async function handleTabFocusChanged(tabId, windowId) {
    gsUtils.log(tabId, 'tab gained focus');
    checkForContextMenuChanges(); // async. unhandled promise

    const focusedTab = await gsChrome.tabsGet(tabId);
    if (!focusedTab) {
      return;
    }
    const previouslyFocusedTabId = gsTabSelector.getCurrentlyFocusedTabIdForWindowId(
      windowId
    );
    if (previouslyFocusedTabId === tabId) {
      //when a tab discards, it can trigger a tab focus event.
      //new tabId can match previouslyFocusedTabId if the old id was updated via updateTabIdReferences
      gsUtils.log(
        tabId,
        'Ignoring tab focus change as new tabId matches previouslyFocusedTabId.'
      );
      return;
    }

    gsTabSelector.setCurrentlyFocusedTabIdForWindowId(windowId, tabId);

    // If the tab focused before this was the keyboard shortcuts page, then update hotkeys on suspended pages
    if (_triggerHotkeyUpdate) {
      const oldHotkey = _suspensionToggleHotkey;
      _suspensionToggleHotkey = await buildSuspensionToggleHotkey();
      if (oldHotkey !== _suspensionToggleHotkey) {
        const suspendedViews = getInternalViewsByViewName('suspended');
        for (const suspendedView of suspendedViews) {
          gsSuspendedTab.updateCommand(suspendedView, _suspensionToggleHotkey);
        }
      }
      _triggerHotkeyUpdate = false;
    }

    gsTabDiscardManager.unqueueTabForDiscard(focusedTab);

    // If normal tab, then ensure it has a responsive content script
    let contentScriptStatus = null;
    if (gsUtils.isNormalTab(focusedTab, true)) {
      contentScriptStatus = await getContentScriptStatus(focusedTab.id);
      if (!contentScriptStatus) {
        contentScriptStatus = await gsTabCheckManager.queueTabCheckAsPromise(
          focusedTab,
          {},
          0
        );
      }
      gsUtils.log(
        focusedTab.id,
        'Content script status: ' + contentScriptStatus
      );
    }

    //update icon (non blocking)
    setTimeout(async () => {
      const status = await calculateTabStatus(focusedTab, contentScriptStatus);
      gsUtils.log(focusedTab.id, 'Focused tab status: ' + status);

      //if this tab still has focus then update icon
      const currentlyFocusedTabId = gsTabSelector.getCurrentlyFocusedTabIdForWindowId(
        windowId
      );
      if (currentlyFocusedTabId === focusedTab.id) {
        setIconStatusForTabId(status, focusedTab.id);
      }
    }, 0);

    //pause for a bit before assuming we're on a new tab as some users
    //will key through intermediate tabs to get to the one they want.
    queueNewTabFocusTimer(tabId, windowId, focusedTab);

    //test for a save of keyboard shortcuts (chrome://extensions/shortcuts)
    if (focusedTab.url === 'chrome://extensions/shortcuts') {
      _triggerHotkeyUpdate = true;
    }

    let discardAfterSuspend = gsStorage.getOption(
      gsStorage.DISCARD_AFTER_SUSPEND
    );
    if (!discardAfterSuspend) {
      return;
    }

    //queue job to discard previously focused tab
    const previouslyFocusedTab = previouslyFocusedTabId
      ? await gsChrome.tabsGet(previouslyFocusedTabId)
      : null;
    if (!previouslyFocusedTab) {
      gsUtils.log(
        previouslyFocusedTabId,
        'Could not find tab. Has probably already been discarded'
      );
      return;
    }
    if (!gsUtils.isSuspendedTab(previouslyFocusedTab)) {
      return;
    }

    //queue tabCheck for previouslyFocusedTab. that will force a discard afterwards
    //but also avoids conflicts if this tab is already scheduled for checking
    gsUtils.log(
      previouslyFocusedTabId,
      'Queueing previously focused tab for discard via tabCheckManager'
    );
    gsTabCheckManager.queueTabCheck(previouslyFocusedTab, {}, 1000);
  }

  function queueNewWindowFocusTimer(tabId, windowId, focusedTab) {
    clearTimeout(_newWindowFocusTimer);
    _newWindowFocusTimer = setTimeout(function() {
      var previousStationaryWindowId = gsTabSelector.getCurrentStationaryWindowId();
      gsTabSelector.setCurrentStationaryWindowId(windowId);
      var previousStationaryTabId = gsTabSelector.getCurrentStationaryTabIdForWindowId(
        previousStationaryWindowId
      );
      handleNewStationaryTabFocus(tabId, previousStationaryTabId, focusedTab);
    }, focusDelay);
  }

  function queueNewTabFocusTimer(tabId, windowId, focusedTab) {
    clearTimeout(_newTabFocusTimer);
    _newTabFocusTimer = setTimeout(function() {
      var previousStationaryTabId = gsTabSelector.getCurrentStationaryTabIdForWindowId(
        windowId
      );
      gsTabSelector.setCurrentStationaryTabIdForWindowId(
        windowId,
        focusedTab.id
      );

      //sometimes it seems that this is a 'fake' tab focus resulting
      //from the popup menu disappearing. in these cases the previousStationaryTabId
      //should match the current tabId (fix for issue #735)
      if (
        !previousStationaryTabId ||
        previousStationaryTabId !== focusedTab.id
      ) {
        handleNewStationaryTabFocus(tabId, previousStationaryTabId, focusedTab);
      }
    }, focusDelay);
  }

  function handleNewStationaryTabFocus(
    focusedTabId,
    previousStationaryTabId,
    focusedTab
  ) {
    gsUtils.log(focusedTabId, 'new stationary tab focus handled');

    if (gsUtils.isSuspendedTab(focusedTab)) {
      handleSuspendedTabFocusGained(focusedTab); //async. unhandled promise.
    } else if (gsUtils.isNormalTab(focusedTab)) {
      const tabQueueState = gsTabSuspendManager.getTabQueueState(focusedTab);
      //if focusedTab is already in the queue for suspension then remove it.
      if (tabQueueState) {
        //only cancel suspension if the tab suspension request has a forceLevel > 1
        const isLowForceLevel = tabQueueState.executionProps.forceLevel > 1;

        if (isLowForceLevel) {
          gsTabSuspendManager.unqueueTabForSuspension(focusedTab);
        }
      }
    } else if (focusedTab.url === chrome.extension.getURL('options.html')) {
      const optionsView = getInternalViewByTabId(focusedTab.id);
      if (optionsView && optionsView.exports) {
        optionsView.exports.initSettings();
      }
    }

    //Reset timer on tab that lost focus.
    //NOTE: This may be due to a change in window focus in which case the tab may still have .active = true
    if (previousStationaryTabId && previousStationaryTabId !== focusedTabId) {
      chrome.tabs.get(previousStationaryTabId, function(previousStationaryTab) {
        if (chrome.runtime.lastError) {
          //Tab has probably been removed
          gsUtils.log(
            previousStationaryTabId,
            chrome.runtime.lastError.message
          );
          return;
        }
        if (
          previousStationaryTab &&
          gsUtils.isNormalTab(previousStationaryTab) &&
          !gsUtils.isProtectedActiveTab(previousStationaryTab)
        ) {
          resetAutoSuspendTimerForTab(previousStationaryTab);
        }
      });
    }
  }

  async function handleSuspendedTabFocusGained(focusedTab) {
    if (focusedTab.status !== 'loading') {
      //safety check to ensure suspended tab has been initialised
      gsTabCheckManager.queueTabCheck(focusedTab, { refetchTab: false }, 0);
    }

    //check for auto-unsuspend
    var autoUnsuspend = gsStorage.getOption(gsStorage.UNSUSPEND_ON_FOCUS);
    if (autoUnsuspend) {
      if (navigator.onLine) {
        await gsTabActions.unsuspendTab(focusedTab);
      } else {
        const suspendedView = getInternalViewByTabId(focusedTab.id);
        if (suspendedView) {
          gsSuspendedTab.showNoConnectivityMessage(suspendedView);
        }
      }
    }
  }

  async function promptForFilePermissions() {
    const activeTab = await gsTabSelector.getCurrentlyActiveTab();
    await gsChrome.tabsCreate({
      url: chrome.extension.getURL('permissions.html'),
      index: activeTab.index + 1,
    });
  }

  function checkForNotices() {
    gsUtils.log('background', 'Checking for notices..');
    var xhr = new XMLHttpRequest();
    var lastShownNoticeVersion = gsStorage.fetchNoticeVersion();

    xhr.open('GET', 'https://greatsuspender.github.io/notice.json', true);
    xhr.timeout = 4000;
    xhr.setRequestHeader('Cache-Control', 'no-cache');
    xhr.onreadystatechange = function() {
      if (xhr.readyState === 4 && xhr.responseText) {
        var resp;
        try {
          resp = JSON.parse(xhr.responseText);
        } catch (e) {
          gsUtils.error(
            'background',
            'Failed to parse notice response',
            xhr.responseText
          );
          return;
        }

        if (!resp || !resp.active || !resp.text) {
          gsUtils.log('background', 'No new notice found');
          return;
        }

        //only show notice if it is intended for this extension version
        var noticeTargetExtensionVersion = String(resp.target);
        if (
          noticeTargetExtensionVersion !== chrome.runtime.getManifest().version
        ) {
          gsUtils.log(
            'background',
            `Notice target extension version: ${noticeTargetExtensionVersion} 
            does not match actual extension version: ${
              chrome.runtime.getManifest().version
            }`
          );
          return;
        }

        //only show notice if it has not already been shown
        var noticeVersion = String(resp.version);
        if (noticeVersion <= lastShownNoticeVersion) {
          gsUtils.log(
            'background',
            `Notice version: ${noticeVersion} is not greater than last shown notice version: ${lastShownNoticeVersion}`
          );
          return;
        }

        //show notice - set global notice field (so that it can be trigger to show later)
        _noticeToDisplay = resp;
        gsAnalytics.reportEvent(
          'Notice',
          'Prep',
          resp.target + ':' + resp.version
        );
      }
    };
    xhr.send();
  }

  async function handleTabCreated(tab) {
    gsUtils.log(tab.id, 'tab created. tabUrl: ' + tab.url);
    gsSession.queueUpdateCurrentSession();
    gsTabState.createNewTabState(tab);

    // It's unusual for a suspended tab to be created. Usually they are updated
    // from a normal tab. This usually happens when using 'reopen closed tab'.
    if (gsUtils.isSuspendedTab(tab) && !tab.active) {
      // Queue tab for check but mark it as sleeping for 5 seconds to give
      // a chance for the tab to load
      gsTabCheckManager.queueTabCheck(tab, {}, 5000);
    }
  }

  async function handleTabRemoved(tabId) {
    gsUtils.log(tabId, 'tab removed.');
    gsSession.queueUpdateCurrentSession();
    gsTabState.removeTabIdReferences(tabId);
  }

  async function handleTabUpdated(tab, changeInfo) {
    if (!changeInfo) return;

    // if url has changed
    if (changeInfo.url) {
      gsUtils.log(tab.id, 'tab url changed. changeInfo: ', changeInfo);
      checkForTriggerUrls(tab, changeInfo.url);
      gsSession.queueUpdateCurrentSession();
    }

    if (gsUtils.isSuspendedTab(tab)) {
      handleSuspendedTabStateChanged(tab, changeInfo);
    } else if (gsUtils.isNormalTab(tab)) {
      await handleUnsuspendedTabStateChanged(tab, changeInfo);
    }
  }

  async function handleWindowCreated(window) {
    gsUtils.log(window.id, 'window created.');
    gsSession.queueUpdateCurrentSession();

    var noticeToDisplay = requestNotice();
    if (noticeToDisplay) {
      chrome.tabs.create({ url: chrome.extension.getURL('notice.html') });
      gsAnalytics.reportEvent(
        'Notice',
        'Display',
        noticeToDisplay.target + ':' + noticeToDisplay.version
      );
    }
  }

  async function handleWindowRemoved(windowId) {
    gsUtils.log(windowId, 'window removed.');
    gsSession.queueUpdateCurrentSession();
  }

  function requestNotice() {
    return _noticeToDisplay;
  }
  function clearNotice() {
    _noticeToDisplay = undefined;
  }

  function isCharging() {
    return _isCharging;
  }

  function handleBatteryChargingChange(battery) {
    _isCharging = battery.charging;
    gsUtils.log('background', `_isCharging: ${_isCharging}`);
    tgs.updateIconStatusForActiveTab(); //async. unhandled promise
    //restart timer on all normal tabs
    //NOTE: some tabs may have been prevented from suspending when computer was charging
    if (!_isCharging && gsStorage.getOption(gsStorage.IGNORE_WHEN_CHARGING)) {
      resetAutoSuspendTimerForAllTabs();
    }
  }

  async function handleOnlineStatusChange(isOnline) {
    if (isOnline) {
      gsUtils.log('background', 'Internet is online.');
      //restart timer on all normal tabs
      //NOTE: some tabs may have been prevented from suspending when internet was offline
      if (gsStorage.getOption(gsStorage.IGNORE_WHEN_OFFLINE)) {
        resetAutoSuspendTimerForAllTabs();
      }
    } else {
      gsUtils.log('background', 'Internet is offline.');
    }
    await tgs.updateIconStatusForActiveTab();
  }

  async function getDebugInfo(tabId) {
    const timerDetails = gsTabState.getTabTimer(tabId);
    const info = {
      windowId: '',
      tabId: '',
      status: gsUtils.STATUS_UNKNOWN,
      timerUp: timerDetails ? timerDetails.suspendDateTime : '-',
    };

    const tab = await gsChrome.tabsGet(tabId);
    if (!tab) {
      return info;
    }

    info.windowId = tab.windowId;
    info.tabId = tab.id;
    if (!gsUtils.isNormalTab(tab, true)) {
      info.status = await calculateTabStatus(tab, null);
      return info;
    }

    const contentScriptInfo = await new Promise(resolve => {
      gsMessages.sendRequestInfoToContentScript(tab.id, (error, tabInfo) => {
        if (error) {
          gsUtils.warning(tab.id, 'Failed to getDebugInfo', error);
        }
        resolve(tabInfo);
      });
    });

    if (contentScriptInfo) {
      info.status = await calculateTabStatus(tab, contentScriptInfo.status);
    }
    return info;
  }

  function getContentScriptStatus(tabId, knownContentScriptStatus) {
    return new Promise(function(resolve) {
      if (knownContentScriptStatus) {
        resolve(knownContentScriptStatus);
      } else {
        gsMessages.sendRequestInfoToContentScript(tabId, function(
          error,
          tabInfo
        ) {
          if (error) {
            gsUtils.warning(tabId, 'Failed to getContentScriptStatus', error);
          }
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
  //blockedFile: a file:// tab that can theoretically be suspended but is being blocked by the user's settings
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
  //charging: computer currently charging (and IGNORE_WHEN_CHARGING is true)
  //noConnectivity: internet currently offline (and IGNORE_WHEN_OFFLINE is true)
  //unknown: an error detecting tab status
  async function calculateTabStatus(tab, knownContentScriptStatus) {
    //check for loading
    if (tab.status === 'loading') {
      return gsUtils.STATUS_LOADING;
    }
    //check if it is a blockedFile tab (this needs to have precedence over isSpecialTab)
    if (gsUtils.isBlockedFileTab(tab)) {
      return gsUtils.STATUS_BLOCKED_FILE;
    }
    //check if it is a special tab
    if (gsUtils.isSpecialTab(tab)) {
      return gsUtils.STATUS_SPECIAL;
    }
    //check if tab has been discarded
    if (gsUtils.isDiscardedTab(tab)) {
      return gsUtils.STATUS_DISCARDED;
    }
    //check if it has already been suspended
    if (gsUtils.isSuspendedTab(tab)) {
      return gsUtils.STATUS_SUSPENDED;
    }
    //check whitelist
    if (gsUtils.checkWhiteList(tab.url)) {
      return gsUtils.STATUS_WHITELISTED;
    }
    //check never suspend
    //should come after whitelist check as it causes popup to show the whitelisting option
    if (gsStorage.getOption(gsStorage.SUSPEND_TIME) === '0') {
      return gsUtils.STATUS_NEVER;
    }

    const contentScriptStatus = await getContentScriptStatus(
      tab.id,
      knownContentScriptStatus
    );
    if (contentScriptStatus && contentScriptStatus !== gsUtils.STATUS_NORMAL) {
      return contentScriptStatus;
    }
    //check running on battery
    if (gsStorage.getOption(gsStorage.IGNORE_WHEN_CHARGING) && _isCharging) {
      return gsUtils.STATUS_CHARGING;
    }
    //check internet connectivity
    if (
      gsStorage.getOption(gsStorage.IGNORE_WHEN_OFFLINE) &&
      !navigator.onLine
    ) {
      return gsUtils.STATUS_NOCONNECTIVITY;
    }
    //check pinned tab
    if (gsUtils.isProtectedPinnedTab(tab)) {
      return gsUtils.STATUS_PINNED;
    }
    //check audible tab
    if (gsUtils.isProtectedAudibleTab(tab)) {
      return gsUtils.STATUS_AUDIBLE;
    }
    //check active
    if (gsUtils.isProtectedActiveTab(tab)) {
      return gsUtils.STATUS_ACTIVE;
    }
    if (contentScriptStatus) {
      return contentScriptStatus; // should be 'normal'
    }
    return gsUtils.STATUS_UNKNOWN;
  }

  async function getActiveTabStatus() {
    const tab = await gsTabSelector.getCurrentlyActiveTab();
    if (!tab) {
      return gsUtils.STATUS_UNKNOWN;
    }
    const status = await calculateTabStatus(tab, null);
    return status;
  }

  async function updateIconStatusForActiveTab() {
    const tab = await gsTabSelector.getCurrentlyActiveTab();
    if (!tab) {
      return;
    }
    await updateIconStatusForTab(tab);
  }

  async function updateIconStatusForTab(tab, knownContentScriptStatus) {
    const tabStatus = await calculateTabStatus(tab, knownContentScriptStatus);
    setIconStatusForTabId(tabStatus, tab.id);
  }

  //change the icon to either active or inactive
  function setIconStatusForTabId(status, tabId) {
    // gsUtils.log(tabId, 'Setting icon status: ' + status);
    var icon = ![gsUtils.STATUS_NORMAL, gsUtils.STATUS_ACTIVE].includes(status)
      ? ICON_SUSPENSION_PAUSED
      : ICON_SUSPENSION_ACTIVE;
    chrome.browserAction.setIcon({ path: icon, tabId: tabId }, function() {
      if (chrome.runtime.lastError) {
        gsUtils.warning(
          tabId,
          chrome.runtime.lastError.message,
          `Failed to set icon for tab. Tab may have been closed.`
        );
      }
    });
  }

  //HANDLERS FOR RIGHT-CLICK CONTEXT MENU
  function buildContextMenu(showContextMenu) {
    const allContexts = [
      'page',
      'frame',
      'editable',
      'image',
      'video',
      'audio',
    ]; //'selection',

    if (!showContextMenu) {
      chrome.contextMenus.removeAll();
    } else {
      chrome.contextMenus.create({
        title: chrome.i18n.getMessage('js_context_open_link_in_suspended_tab'),
        contexts: ['link'],
        onclick: (info, tab) => {
          openLinkInSuspendedTab(tab, info.linkUrl);
        },
      });

      _cmidSuspendToggle = chrome.contextMenus.create({
        title: chrome.i18n.getMessage('js_context_toggle_suspend_state'),
        contexts: allContexts,
        onclick: async () =>
          await gsTabActions.toggleSuspendedStateOfSelectedTabs(),
      });
      _cmidPauseToggle = chrome.contextMenus.create({
        title: chrome.i18n.getMessage('js_context_toggle_pause_suspension'),
        contexts: allContexts,
        onclick: async () =>
          await gsTabActions.toggleTempWhitelistStateOfSelectedTabs(),
      });

      chrome.contextMenus.create({
        title: chrome.i18n.getMessage('js_context_never_suspend_page'),
        contexts: allContexts,
        onclick: async () => await gsTabActions.whitelistHighlightedTab(true),
      });
      chrome.contextMenus.create({
        title: chrome.i18n.getMessage('js_context_never_suspend_domain'),
        contexts: allContexts,
        onclick: async () => await gsTabActions.whitelistHighlightedTab(false),
      });

      chrome.contextMenus.create({
        type: 'separator',
        contexts: allContexts,
      });

      chrome.contextMenus.create({
        type: 'separator',
        contexts: allContexts,
      });
      chrome.contextMenus.create({
        title: chrome.i18n.getMessage(
          'js_context_soft_suspend_other_tabs_in_window'
        ),
        contexts: allContexts,
        onclick: async () => await gsTabActions.suspendAllTabs(false),
      });
      chrome.contextMenus.create({
        title: chrome.i18n.getMessage(
          'js_context_force_suspend_other_tabs_in_window'
        ),
        contexts: allContexts,
        onclick: async () => await gsTabActions.suspendAllTabs(true),
      });
      chrome.contextMenus.create({
        title: chrome.i18n.getMessage(
          'js_context_unsuspend_all_tabs_in_window'
        ),
        contexts: allContexts,
        onclick: async () => await gsTabActions.unsuspendAllTabs(),
      });

      chrome.contextMenus.create({
        type: 'separator',
        contexts: allContexts,
      });
      chrome.contextMenus.create({
        title: chrome.i18n.getMessage('js_context_soft_suspend_all_tabs'),
        contexts: allContexts,
        onclick: async () =>
          await gsTabActions.suspendAllTabsInAllWindows(false),
      });
      chrome.contextMenus.create({
        title: chrome.i18n.getMessage('js_context_force_suspend_all_tabs'),
        contexts: allContexts,
        onclick: async () =>
          await gsTabActions.suspendAllTabsInAllWindows(true),
      });
      chrome.contextMenus.create({
        title: chrome.i18n.getMessage('js_context_unsuspend_all_tabs'),
        contexts: allContexts,
        onclick: async () => await gsTabActions.unsuspendAllTabsInAllWindows(),
      });
    }
  }

  async function checkForContextMenuChanges() {
    gsUtils.log('background', 'Checking for context menu changes');
    let currentWindowId = gsTabSelector.getCurrentlyFocusedWindowId();
    if (!currentWindowId) {
      let currentWindow = await gsChrome.windowsGetLastFocused();
      if (!currentWindow) {
        return;
      }
      currentWindowId = currentWindow.id;
    }
    const selectedTabId = gsTabSelector.getCurrentlyFocusedTabIdForWindowId(
      currentWindowId
    );
    if (!selectedTabId) {
      return;
    }
    // const isSuspended = TODO: xx;
    const activeTabs = await gsChrome.tabsQuery({
      highlighted: true,
      windowId: currentWindowId,
    });
    if (activeTabs && activeTabs.length > 1) {
      gsUtils.log('background', 'Multiple tabs highlighted in this window');
      chrome.contextMenus.update(_cmidSuspendToggle, {
        title: chrome.i18n.getMessage(
          'ext_cmd_suspend_selected_tabs_description'
        ),
      });
      chrome.contextMenus.update(_cmidPauseToggle, {
        title: chrome.i18n.getMessage('html_about_html2canvas'),
      });
    } else {
      gsUtils.log('background', 'Only one tab highlighted in this window');
      chrome.contextMenus.update(_cmidSuspendToggle, {
        title: chrome.i18n.getMessage('js_context_toggle_suspend_state'),
      });
      chrome.contextMenus.update(_cmidPauseToggle, {
        title: chrome.i18n.getMessage('js_context_toggle_pause_suspension'),
      });
    }
  }

  function startNoticeCheckerJob() {
    checkForNotices();
    window.setInterval(checkForNotices, noticeCheckInterval);
  }

  function startSessionMetricsJob() {
    gsSession.updateSessionMetrics(true);
    window.setInterval(
      gsSession.updateSessionMetrics,
      sessionMetricsCheckInterval
    );
  }

  function startAnalyticsUpdateJob() {
    window.setInterval(() => {
      gsAnalytics.performPingReport();
      const reset = true;
      gsSession.updateSessionMetrics(reset);
    }, analyticsCheckInterval);
  }

  return {
    backgroundScriptsReadyAsPromised,
    initAsPromised,
    performTabChecks,
    initialiseTabContentScript,
    setViewGlobals,
    getInternalViewByTabId,
    getInternalViewsByViewName,
    startTimers,
    requestNotice,
    clearNotice,
    buildContextMenu,
    getActiveTabStatus,
    getDebugInfo,
    calculateTabStatus,
    updateIconStatusForActiveTab,
    updateIconStatusForTab,
    isCharging,
    clearAutoSuspendTimerForTabId,
    resetAutoSuspendTimerForTab,
    resetAutoSuspendTimerForAllTabs,
    getSuspensionToggleHotkey,
    promptForFilePermissions,

    handleWindowFocusChanged,
    handleTabFocusChanged,
    handleTabCreated,
    handleTabRemoved,
    handleTabUpdated,
    handleWindowCreated,
    handleWindowRemoved,
    handleBatteryChargingChange,
    handleOnlineStatusChange,
  };
})();

Promise.resolve()
  .then(tgs.backgroundScriptsReadyAsPromised) // wait until all gsLibs have loaded
  .then(gsStorage.initSettingsAsPromised) // ensure settings have been loaded and synced
  .then(() => {
    // initialise other gsLibs
    return Promise.all([
      gsAnalytics.initAsPromised(),
      gsFavicon.initAsPromised(),
      gsTabSelector.initAsPromised(),
      gsTabSuspendManager.initAsPromised(),
      gsTabCheckManager.initAsPromised(),
      gsTabDiscardManager.initAsPromised(),
      gsSession.initAsPromised(),
    ]);
  })
  .catch(error => {
    gsUtils.error('background init error: ', error);
  })
  .then(() => {
    gsSession.setInitialising(true);
    gsSession.runStartupChecks();
  }) // performs crash check
  .catch(error => {
    gsUtils.error('background gsSession.runStartupChecks error: ', error);
  })
  .then(() => {
    tgs.performTabChecks();
    gsSession.setInitialising(false);
  }) // init tabStates and perform tab responsiveness checks
  .catch(error => {
    gsUtils.error('background tgs.runStartupChecks error: ', error);
  })
  .then(gsEvents.initAsPromised) // adds handle(Un)SuspendedTabChanged listeners!
  .then(tgs.initAsPromised) // sets suspend timers on tabs
  .catch(error => {
    gsUtils.error('background init error: ', error);
  })
  .finally(() => {
    gsAnalytics.performStartupReport();
    gsAnalytics.performVersionReport();
    tgs.startTimers();
  });
