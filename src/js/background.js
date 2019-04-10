/* global gsStorage, gsChrome, gsIndexedDb, gsTabActions, gsUtils, gsFavicon, gsSession, gsMessages, gsTabSelector, gsTabSuspendManager, gsTabDiscardManager, gsAnalytics, gsTabCheckManager, gsSuspendedTab, chrome, XMLHttpRequest */
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

  // Unsuspended tab props
  const STATE_TIMER_DETAILS = 'timerDetails';

  // Suspended tab props
  const STATE_TEMP_WHITELIST_ON_RELOAD = 'whitelistOnReload';
  const STATE_DISABLE_UNSUSPEND_ON_RELOAD = 'disableUnsuspendOnReload';
  const STATE_INITIALISE_SUSPENDED_TAB = 'initialiseSuspendedTab';
  const STATE_UNLOADED_URL = 'unloadedUrl';
  const STATE_HISTORY_URL_TO_REMOVE = 'historyUrlToRemove';
  const STATE_SET_AUTODISCARDABLE = 'setAutodiscardable';
  const STATE_SHOW_NAG = 'showNag';
  const STATE_SUSPEND_REASON = 'suspendReason'; // 1=auto-suspend, 2=manual-suspend, 3=discarded
  const STATE_SCROLL_POS = 'scrollPos';

  const focusDelay = 500;
  const noticeCheckInterval = 1000 * 60 * 60 * 12; // every 12 hours
  const sessionMetricsCheckInterval = 1000 * 60 * 15; // every 15 minutes
  const analyticsCheckInterval = 1000 * 60 * 60 * 23.5; // every 23.5 hours

  const _tabStateByTabId = {};
  let _sessionSaveTimer;
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
      addCommandListeners();
      addMessageListeners();
      addChromeListeners();
      addMiscListeners();

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

  function queueSessionTimer() {
    clearTimeout(_sessionSaveTimer);
    _sessionSaveTimer = setTimeout(function() {
      gsUtils.log('background', 'updating current session');
      gsSession.updateCurrentSession(); //async
    }, 1000);
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

    setTabStatePropForTabId(tab.id, STATE_TIMER_DETAILS, timerDetails);
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
    const timerDetails = getTabStatePropForTabId(tabId, STATE_TIMER_DETAILS);
    if (!timerDetails) {
      return;
    }
    gsUtils.log(tabId, 'Removing tab timer.');
    clearTimeout(timerDetails.timer);
    setTabStatePropForTabId(tabId, STATE_TIMER_DETAILS, null);
  }

  function getTabStatePropForTabId(tabId, prop) {
    return _tabStateByTabId[tabId] ? _tabStateByTabId[tabId][prop] : undefined;
  }
  function setTabStatePropForTabId(tabId, prop, value) {
    // gsUtils.log(tabId, `Setting tab state prop: ${prop}:`, value);
    const tabState = _tabStateByTabId[tabId] || {};
    tabState[prop] = value;
    _tabStateByTabId[tabId] = tabState;
  }
  function clearTabStateForTabId(tabId) {
    gsUtils.log(tabId, 'Clearing tab state props:', _tabStateByTabId[tabId]);
    clearAutoSuspendTimerForTabId(tabId);
    delete _tabStateByTabId[tabId];
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

    // Ensure we clear the STATE_UNLOADED_URL flag during load in case the
    // tab is suspended again before loading can finish (in which case on
    // suspended tab complete, the tab will reload again)
    if (
      changeInfo.hasOwnProperty('status') &&
      changeInfo.status === 'loading'
    ) {
      setTabStatePropForTabId(tab.id, STATE_UNLOADED_URL, null);
    }

    // Check if tab has just been discarded
    if (changeInfo.hasOwnProperty('discarded') && changeInfo.discarded) {
      const existingSuspendReason = getTabStatePropForTabId(
        tab.id,
        STATE_SUSPEND_REASON
      );
      if (existingSuspendReason && existingSuspendReason === 3) {
        // For some reason the discarded changeInfo gets called twice (chrome bug?)
        // As a workaround we use the suspend reason to determine if we've already
        // handled this discard
        //TODO: Report chrome bug
        return;
      }
      gsUtils.log(
        tab.id,
        'Unsuspended tab has been discarded. Url: ' + tab.url
      );
      gsTabDiscardManager.handleDiscardedUnsuspendedTab(tab); //async. unhandled promise.

      // When a tab is discarded the tab id changes. We need up-to-date UNSUSPENDED
      // tabIds in the current session otherwise crash recovery will not work
      queueSessionTimer();
      return;
    }

    // Check if tab is queued for suspension
    const queuedTabDetails = gsTabSuspendManager.getQueuedTabDetails(tab);
    if (queuedTabDetails) {
      // Requeue tab to wake it from possible sleep
      delete queuedTabDetails.executionProps.refetchTab;
      gsTabSuspendManager.queueTabForSuspension(
        tab,
        queuedTabDetails.executionProps.forceLevel
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
        const tempWhitelistOnReload = getTabStatePropForTabId(
          tab.id,
          STATE_TEMP_WHITELIST_ON_RELOAD
        );
        const scrollPos =
          getTabStatePropForTabId(tab.id, STATE_SCROLL_POS) || null;
        const historyUrlToRemove = getTabStatePropForTabId(
          tab.id,
          STATE_HISTORY_URL_TO_REMOVE
        );
        const setAutodiscardable = getTabStatePropForTabId(
          tab.id,
          STATE_SET_AUTODISCARDABLE
        );
        clearTabStateForTabId(tab.id);

        if (historyUrlToRemove) {
          removeTabHistoryForUnuspendedTab(historyUrlToRemove);
        }
        if (setAutodiscardable) {
          gsChrome.tabsUpdate(tab.id, { autoDiscardable: true });
        }

        //init loaded tab
        resetAutoSuspendTimerForTab(tab);
        initialiseTabContentScript(tab, tempWhitelistOnReload, scrollPos)
          .catch(error => {
            gsUtils.warning(
              tab.id,
              'Failed to send init to content script. Tab may not behave as expected.'
            );
          })
          .then(() => {
            // could use returned tab status here below
          });
      }

      hasTabStatusChanged = true;
    }

    //if tab is currently visible then update popup icon
    if (hasTabStatusChanged && gsTabSelector.isCurrentFocusedTab(tab)) {
      const status = await calculateTabStatus(tab, null);
      setIconStatus(status, tab.id);
    }
  }

  function removeTabHistoryForUnuspendedTab(suspendedUrl) {
    chrome.history.deleteUrl({ url: suspendedUrl });
    const originalUrl = gsUtils.getOriginalUrl(suspendedUrl);
    chrome.history.getVisits({ url: originalUrl }, visits => {
      //assume history entry will be the second to latest one (latest one is the currently visible page)
      //NOTE: this will break if the same url has been visited by another tab more recently than the
      //suspended tab (pre suspension)
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

    if (changeInfo.status && changeInfo.status === 'loading') {
      tgs.setTabStatePropForTabId(
        tab.id,
        tgs.STATE_INITIALISE_SUSPENDED_TAB,
        true
      );
      return;
    }

    if (
      (changeInfo.status && changeInfo.status === 'complete') ||
      changeInfo.discarded
    ) {
      gsTabSuspendManager.unqueueTabForSuspension(tab); //safety precaution
      const shouldInitTab = getTabStatePropForTabId(
        tab.id,
        STATE_INITIALISE_SUSPENDED_TAB
      );
      if (shouldInitTab) {
        initialiseSuspendedTab(tab);
      }
    }
  }

  function initialiseSuspendedTab(tab) {
    const unloadedUrl = getTabStatePropForTabId(tab.id, STATE_UNLOADED_URL);
    const disableUnsuspendOnReload = getTabStatePropForTabId(
      tab.id,
      STATE_DISABLE_UNSUSPEND_ON_RELOAD
    );
    let showNag = tgs.getTabStatePropForTabId(tab.id, tgs.STATE_SHOW_NAG);
    clearTabStateForTabId(tab.id);

    if (gsTabSelector.isCurrentFocusedTab(tab)) {
      setIconStatus(gsUtils.STATUS_SUSPENDED, tab.id);
    }

    //if a suspended tab is marked for unsuspendOnReload then unsuspend tab and return early
    const suspendedTabRefreshed = unloadedUrl === tab.url;
    if (suspendedTabRefreshed && !disableUnsuspendOnReload) {
      gsTabActions.unsuspendTab(tab); //async. unhandled promise
      return;
    }

    const tabView = tgs.getInternalViewByTabId(tab.id);
    const quickInit =
      gsStorage.getOption(gsStorage.DISCARD_AFTER_SUSPEND) && !tab.active;
    gsSuspendedTab
      .initTab(tab, tabView, { quickInit, showNag })
      .catch(error => {
        gsUtils.warning(tab.id, error);
      })
      .then(() => {
        gsTabCheckManager.queueTabCheck(tab, { refetchTab: true }, 3000);
      });
  }

  function updateTabIdReferences(newTabId, oldTabId) {
    gsUtils.log(oldTabId, 'update tabId references to ' + newTabId);
    gsTabSelector.updateTabIdReferences(newTabId, oldTabId);
    if (_tabStateByTabId[oldTabId]) {
      _tabStateByTabId[newTabId] = _tabStateByTabId[oldTabId];
      delete _tabStateByTabId[oldTabId];
    }
    const timerDetails = getTabStatePropForTabId(newTabId, STATE_TIMER_DETAILS);
    if (timerDetails) {
      timerDetails.tabId = newTabId;
    }
  }

  function removeTabIdReferences(tabId) {
    gsUtils.log(tabId, 'removing tabId references to ' + tabId);
    gsTabSelector.removeTabIdReferences(tabId);
    clearTabStateForTabId(tabId);
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
    const status = await calculateTabStatus(focusedTab, null);
    setIconStatus(status, focusedTab.id);
  }

  async function handleTabFocusChanged(tabId, windowId) {
    gsUtils.log(tabId, 'tab gained focus');

    const focusedTab = await gsChrome.tabsGet(tabId);
    if (!focusedTab) {
      // If focusedTab is null then assume tab has been discarded between the
      // time the chrome.tabs.onActivated event was activated and now.
      // If so, then a subsequeunt chrome.tabs.onActivated event will be called
      // with the new discarded id
      gsUtils.log(
        tabId,
        'Could not find newly focused tab. Assuming it has been discarded'
      );
      return;
    }

    const previouslyFocusedTabId = gsTabSelector.getCurrentlyFocusedTabIdForWindowId(
      windowId
    );
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
        setIconStatus(status, focusedTab.id);
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
      handleNewStationaryTabFocus(tabId, previousStationaryTabId, focusedTab);
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
      const queuedTabDetails = gsTabSuspendManager.getQueuedTabDetails(
        focusedTab
      );
      //if focusedTab is already in the queue for suspension then remove it.
      if (queuedTabDetails) {
        //although sometimes it seems that this is a 'fake' tab focus resulting
        //from the popup menu disappearing. in these cases the previousStationaryTabId
        //should match the current tabId (fix for issue #735)
        const isRealTabFocus =
          previousStationaryTabId && previousStationaryTabId !== focusedTabId;

        //also, only cancel suspension if the tab suspension request has a forceLevel > 1
        const isLowForceLevel = queuedTabDetails.executionProps.forceLevel > 1;

        if (isRealTabFocus && isLowForceLevel) {
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

  function requestNotice() {
    return _noticeToDisplay;
  }
  function clearNotice() {
    _noticeToDisplay = undefined;
  }

  function isCharging() {
    return _isCharging;
  }

  async function getDebugInfo(tabId) {
    const timerDetails = getTabStatePropForTabId(tabId, STATE_TIMER_DETAILS);
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

  //change the icon to either active or inactive
  function setIconStatus(status, tabId) {
    // gsUtils.log(tabId, 'Setting icon status: ' + status);
    var icon = ![gsUtils.STATUS_NORMAL, gsUtils.STATUS_ACTIVE].includes(status)
      ? ICON_SUSPENSION_PAUSED
      : ICON_SUSPENSION_ACTIVE;
    chrome.browserAction.setIcon({ path: icon, tabId: tabId }, function() {
      if (chrome.runtime.lastError) {
        gsUtils.warning(
          tabId,
          chrome.runtime.lastError,
          `Failed to set icon for tab. Tab may have been closed.`
        );
      }
    });
  }

  async function setIconStatusForActiveTab() {
    const tab = await gsTabSelector.getCurrentlyActiveTab();
    if (!tab) {
      return;
    }
    const status = await calculateTabStatus(tab, null);
    setIconStatus(status, tab.id);
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
    // const isSuspended = xx;
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

  //HANDLERS FOR KEYBOARD SHORTCUTS

  function addCommandListeners() {
    chrome.commands.onCommand.addListener(async command => {
      if (command === '1-suspend-tab') {
        await gsTabActions.toggleSuspendedStateOfSelectedTabs();
      } else if (command === '2-toggle-temp-whitelist-tab') {
        await gsTabActions.toggleTempWhitelistStateOfSelectedTabs();
      } else if (command === '3-suspend-active-window') {
        await gsTabActions.suspendAllTabs(false);
      } else if (command === '3b-force-suspend-active-window') {
        await gsTabActions.suspendAllTabs(true);
      } else if (command === '4-unsuspend-active-window') {
        await gsTabActions.unsuspendAllTabs();
      } else if (command === '4b-soft-suspend-all-windows') {
        await gsTabActions.suspendAllTabsInAllWindows(false);
      } else if (command === '5-suspend-all-windows') {
        await gsTabActions.suspendAllTabsInAllWindows(true);
      } else if (command === '6-unsuspend-all-windows') {
        await gsTabActions.unsuspendAllTabsInAllWindows();
      }
    });
  }

  //HANDLERS FOR MESSAGE REQUESTS

  function messageRequestListener(request, sender, sendResponse) {
    gsUtils.log(
      sender.tab.id,
      'background messageRequestListener',
      request.action
    );

    if (request.action === 'reportTabState') {
      var contentScriptStatus =
        request && request.status ? request.status : null;
      if (
        contentScriptStatus === 'formInput' ||
        contentScriptStatus === 'tempWhitelist'
      ) {
        chrome.tabs.update(sender.tab.id, { autoDiscardable: false });
      } else if (!sender.tab.autoDiscardable) {
        chrome.tabs.update(sender.tab.id, { autoDiscardable: true });
      }
      // If tab is currently visible then update popup icon
      if (sender.tab && gsTabSelector.isCurrentFocusedTab(sender.tab)) {
        calculateTabStatus(sender.tab, contentScriptStatus).then(status => {
          setIconStatus(status, sender.tab.id);
        });
      }
      sendResponse();
      return false;
    }

    if (request.action === 'savePreviewData') {
      gsTabSuspendManager.handlePreviewImageResponse(
        sender.tab,
        request.previewUrl,
        request.errorMsg
      ); // async. unhandled promise
      sendResponse();
      return false;
    }

    // Fallback to empty response to ensure callback is made
    sendResponse();
    return false;
  }

  function externalMessageRequestListener(request, sender, sendResponse) {
    gsUtils.log('background', 'external message request: ', request, sender);

    if (!request.action || !['suspend', 'unsuspend'].includes(request.action)) {
      sendResponse('Error: unknown request.action: ' + request.action);
      return;
    }

    // wrap this in an anonymous async function so we can use await
    (async function() {
      let tab;
      if (request.tabId) {
        if (typeof request.tabId !== 'number') {
          sendResponse('Error: tabId must be an int');
          return;
        }
        tab = await gsChrome.tabsGet(request.tabId);
        if (!tab) {
          sendResponse('Error: no tab found with id: ' + request.tabId);
          return;
        }
      } else {
        tab = await gsTabSelector.getCurrentlyActiveTab();
      }
      if (!tab) {
        sendResponse('Error: failed to find a target tab');
        return;
      }

      if (request.action === 'suspend') {
        if (gsUtils.isSuspendedTab(tab, true)) {
          sendResponse('Error: tab is already suspended');
          return;
        }

        gsTabSuspendManager.queueTabForSuspension(tab, 1);
        sendResponse();
        return;
      }

      if (request.action === 'unsuspend') {
        if (!gsUtils.isSuspendedTab(tab)) {
          sendResponse('Error: tab is not suspended');
          return;
        }

        await gsTabActions.unsuspendTab(tab);
        sendResponse();
        return;
      }
    })();
    return true;
  }

  function addMessageListeners() {
    chrome.runtime.onMessage.addListener(messageRequestListener);
    //attach listener to runtime for external messages, to allow
    //interoperability with other extensions in the manner of an API
    chrome.runtime.onMessageExternal.addListener(
      externalMessageRequestListener
    );
  }

  function addChromeListeners() {
    chrome.windows.onFocusChanged.addListener(async windowId => {
      await handleWindowFocusChanged(windowId);
      if (windowId > 0) {
        checkForContextMenuChanges(); // async. unhandled promise
      }
    });
    chrome.tabs.onActivated.addListener(async activeInfo => {
      handleTabFocusChanged(activeInfo.tabId, activeInfo.windowId); // async. unhandled promise
      checkForContextMenuChanges(); // async. unhandled promise
    });
    chrome.tabs.onReplaced.addListener(async (addedTabId, removedTabId) => {
      updateTabIdReferences(addedTabId, removedTabId);
    });
    chrome.tabs.onCreated.addListener(async tab => {
      gsUtils.log(tab.id, 'tab created. tabUrl: ' + tab.url);
      queueSessionTimer();

      // It's unusual for a suspended tab to be created. Usually they are updated
      // from a normal tab. This usually happens when using 'reopen closed tab'.
      if (gsUtils.isSuspendedTab(tab) && !tab.active) {
        // Queue tab for check but mark it as sleeping for 5 seconds to give
        // a chance for the tab to load
        gsTabCheckManager.queueTabCheck(tab, {}, 5000);
      }
    });
    chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
      gsUtils.log(tabId, 'tab removed.');
      queueSessionTimer();
      removeTabIdReferences(tabId);
    });
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      if (!changeInfo) return;

      // if url has changed
      if (changeInfo.url) {
        gsUtils.log(tabId, 'tab url changed. changeInfo: ', changeInfo);
        checkForTriggerUrls(tab, changeInfo.url);
        queueSessionTimer();
      }

      if (gsUtils.isSuspendedTab(tab)) {
        handleSuspendedTabStateChanged(tab, changeInfo);
      } else if (gsUtils.isNormalTab(tab)) {
        await handleUnsuspendedTabStateChanged(tab, changeInfo);
      }
    });
    chrome.windows.onCreated.addListener(async window => {
      gsUtils.log(window.id, 'window created.');
      queueSessionTimer();

      var noticeToDisplay = requestNotice();
      if (noticeToDisplay) {
        chrome.tabs.create({ url: chrome.extension.getURL('notice.html') });
        gsAnalytics.reportEvent(
          'Notice',
          'Display',
          noticeToDisplay.target + ':' + noticeToDisplay.version
        );
      }
    });
    chrome.windows.onRemoved.addListener(async windowId => {
      gsUtils.log(windowId, 'window removed.');
      queueSessionTimer();
    });
  }

  function addMiscListeners() {
    //add listener for battery state changes
    if (navigator.getBattery) {
      navigator.getBattery().then(function(battery) {
        _isCharging = battery.charging;

        battery.onchargingchange = function() {
          _isCharging = battery.charging;
          gsUtils.log('background', `_isCharging: ${_isCharging}`);
          setIconStatusForActiveTab(); //async. unhandled promise
          //restart timer on all normal tabs
          //NOTE: some tabs may have been prevented from suspending when computer was charging
          if (
            !_isCharging &&
            gsStorage.getOption(gsStorage.IGNORE_WHEN_CHARGING)
          ) {
            resetAutoSuspendTimerForAllTabs();
          }
        };
      });
    }

    //add listeners for online/offline state changes
    window.addEventListener('online', async () => {
      gsUtils.log('background', 'Internet is online.');
      //restart timer on all normal tabs
      //NOTE: some tabs may have been prevented from suspending when internet was offline
      if (gsStorage.getOption(gsStorage.IGNORE_WHEN_OFFLINE)) {
        resetAutoSuspendTimerForAllTabs();
      }
      await setIconStatusForActiveTab();
    });
    window.addEventListener('offline', async () => {
      gsUtils.log('background', 'Internet is offline.');
      await setIconStatusForActiveTab();
    });
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
    STATE_TIMER_DETAILS,
    STATE_UNLOADED_URL,
    STATE_INITIALISE_SUSPENDED_TAB,
    STATE_HISTORY_URL_TO_REMOVE,
    STATE_TEMP_WHITELIST_ON_RELOAD,
    STATE_DISABLE_UNSUSPEND_ON_RELOAD,
    STATE_SET_AUTODISCARDABLE,
    STATE_SUSPEND_REASON,
    STATE_SCROLL_POS,
    STATE_SHOW_NAG,
    getTabStatePropForTabId,
    setTabStatePropForTabId,

    backgroundScriptsReadyAsPromised,
    initAsPromised,
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
    setIconStatus,
    isCharging,
    clearAutoSuspendTimerForTabId,
    resetAutoSuspendTimerForTab,
    resetAutoSuspendTimerForAllTabs,
    getSuspensionToggleHotkey,
    promptForFilePermissions,
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
  .then(gsSession.runStartupChecks) // performs crash check (and maybe recovery) and tab responsiveness checks
  .catch(error => {
    gsUtils.error('background startup checks error: ', error);
  })
  .then(tgs.initAsPromised) // adds handle(Un)SuspendedTabChanged listeners!
  .catch(error => {
    gsUtils.error('background init error: ', error);
  })
  .finally(() => {
    gsAnalytics.performStartupReport();
    gsAnalytics.performVersionReport();
    tgs.startTimers();
  });
