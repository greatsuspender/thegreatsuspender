/* global gsStorage, gsChrome, gsIndexedDb, gsUtils, gsSession, gsMessages, gsSuspendManager, gsAnalytics, chrome, XMLHttpRequest */
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

  var ICON_SUSPENSION_ACTIVE = {
    '16': 'img/ic_suspendy_16x16.png',
    '32': 'img/ic_suspendy_32x32.png',
  };
  var ICON_SUSPENSION_PAUSED = {
    '16': 'img/ic_suspendy_16x16_grey.png',
    '32': 'img/ic_suspendy_32x32_grey.png',
  };

  var TEMP_WHITELIST_ON_RELOAD = 'whitelistOnReload';
  var UNSUSPEND_ON_RELOAD_URL = 'unsuspendOnReloadUrl';
  var DISCARD_ON_LOAD = 'discardOnLoad';
  var SUSPEND_REASON = 'suspendReason'; // 1=auto-suspend, 2=manual-suspend, 3=discarded
  var SCROLL_POS = 'scrollPos';
  var SPAWNED_TAB_CREATE_TIMESTAMP = 'spawnedTabCreateTimestamp';
  var FOCUS_DELAY = 500;

  var noticeCheckInterval = 1000 * 60 * 60 * 12; // every 12 hours
  var sessionMetricsCheckInterval = 1000 * 60 * 15; // every 15 minutes
  var analyticsCheckInterval = 1000 * 60 * 60 * 23.5; // every 23.5 hours

  var _currentFocusedTabIdByWindowId = {},
    _currentFocusedWindowId,
    _currentStationaryTabIdByWindowId = {},
    _currentStationaryWindowId,
    _sessionSaveTimer,
    _newTabFocusTimer,
    _newWindowFocusTimer,
    _noticeToDisplay,
    _isCharging = false,
    _triggerHotkeyUpdate = false,
    _suspendUnsuspendHotkey,
    _tabFlagsByTabId = {};

  function backgroundScriptsReadyAsPromised(retries) {
    retries = retries || 0;
    if (retries > 300) {
      // allow 30 seconds :scream:
      chrome.tabs.create({ url: chrome.extension.getURL('broken.html') });
      return Promise.reject('Failed to initialise background scripts');
    }
    return new Promise(function(resolve) {
      var isReady =
        typeof db !== 'undefined' &&
        typeof gsSession !== 'undefined' &&
        typeof gsStorage !== 'undefined' &&
        typeof gsMessages !== 'undefined' &&
        typeof gsUtils !== 'undefined' &&
        typeof gsAnalytics !== 'undefined';
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
    return new Promise(function(resolve) {
      gsUtils.log('background', 'PERFORMING BACKGROUND INIT...');
      addCommandListeners();
      addChromeListeners();
      addMiscListeners();

      //add context menu items
      if (!chrome.extension.inIncognitoContext) {
        buildContextMenu(false);
        var contextMenus = gsStorage.getOption(gsStorage.ADD_CONTEXT);
        buildContextMenu(contextMenus);
      }

      //initialise currentStationary and currentFocused vars
      getCurrentlyActiveTab(function(activeTab) {
        if (activeTab) {
          _currentStationaryWindowId = activeTab.windowId;
          _currentFocusedWindowId = activeTab.windowId;
          _currentStationaryTabIdByWindowId[activeTab.windowId] = activeTab.id;
          _currentFocusedTabIdByWindowId[activeTab.windowId] = activeTab.id;
        }
        resolve();
      });
    });
  }

  function startTimers() {
    startNoticeCheckerJob();
    startSessionMetricsJob();
    startAnalyticsUpdateJob();
  }

  function getCurrentlyActiveTab(callback) {
    // wrap this in an anonymous async function so we can use await
    (async function() {
      const currentWindowActiveTabs = await gsChrome.tabsQuery({
        active: true,
        currentWindow: true,
      });
      if (currentWindowActiveTabs.length > 0) {
        callback(currentWindowActiveTabs[0]);
        return;
      }
      if (!_currentStationaryWindowId) {
        callback(null);
        return;
      }

      const currentStationaryWindowActiveTabs = await gsChrome.tabsQuery({
        active: true,
        windowId: _currentStationaryWindowId,
      });
      if (currentStationaryWindowActiveTabs.length > 0) {
        callback(currentStationaryWindowActiveTabs[0]);
        return;
      }
      const currentStationaryTabId =
        _currentStationaryTabIdByWindowId[_currentStationaryWindowId];
      if (!currentStationaryTabId) {
        callback(null);
        return;
      }

      const currentStationaryTab = await gsChrome.tabsGet(
        currentStationaryTabId
      );
      if (currentStationaryTab !== null) {
        callback(currentStationaryTab);
        return;
      }
      callback(null);
    })();
  }

  // NOTE: Stationary here means has had focus for more than FOCUS_DELAY ms
  // So it may not necessarily have the tab.active flag set to true
  function isCurrentStationaryTab(tab) {
    if (tab.windowId !== _currentStationaryWindowId) {
      return false;
    }
    var lastStationaryTabIdForWindow =
      _currentStationaryTabIdByWindowId[tab.windowId];
    if (lastStationaryTabIdForWindow) {
      return tab.id === lastStationaryTabIdForWindow;
    } else {
      // fallback on active flag
      return tab.active;
    }
  }

  function isCurrentFocusedTab(tab) {
    if (tab.windowId !== _currentFocusedWindowId) {
      return false;
    }
    var currentFocusedTabIdForWindow =
      _currentFocusedTabIdByWindowId[tab.windowId];
    if (currentFocusedTabIdForWindow) {
      return tab.id === currentFocusedTabIdForWindow;
    } else {
      // fallback on active flag
      return tab.active;
    }
  }

  function whitelistHighlightedTab(includePath) {
    includePath = includePath || false;
    getCurrentlyActiveTab(function(activeTab) {
      if (activeTab) {
        if (gsUtils.isSuspendedTab(activeTab)) {
          let url = gsUtils.getRootUrl(
            gsUtils.getSuspendedUrl(activeTab.url),
            includePath
          );
          gsUtils.saveToWhitelist(url);
          unsuspendTab(activeTab);
        } else {
          let url = gsUtils.getRootUrl(activeTab.url, includePath);
          gsUtils.saveToWhitelist(url);
          calculateTabStatus(activeTab, null, function(status) {
            setIconStatus(status, activeTab.id);
          });
        }
      }
    });
  }

  function unwhitelistHighlightedTab(callback) {
    getCurrentlyActiveTab(function(activeTab) {
      if (activeTab) {
        gsUtils.removeFromWhitelist(activeTab.url);
        calculateTabStatus(activeTab, null, function(status) {
          setIconStatus(status, activeTab.id);
          if (callback) callback(status);
        });
      } else {
        if (callback) callback(gsUtils.STATUS_UNKNOWN);
      }
    });
  }

  function toggleTempWhitelistStateOfHighlightedTab(callback) {
    getCurrentlyActiveTab(function(activeTab) {
      if (!activeTab) {
        if (callback) callback(status);
        return;
      }
      if (gsUtils.isSuspendedTab(activeTab)) {
        gsMessages.sendTemporaryWhitelistToSuspendedTab(activeTab.id); //async. unhandled error
        if (callback) callback(gsUtils.STATUS_UNKNOWN);
        return;
      }
      calculateTabStatus(activeTab, null, function(status) {
        if (
          status === gsUtils.STATUS_ACTIVE ||
          status === gsUtils.STATUS_NORMAL
        ) {
          gsMessages.sendTemporaryWhitelistToContentScript(
            activeTab.id,
            function(error, response) {
              if (error) {
                gsUtils.warning(
                  activeTab.id,
                  'Failed to sendTemporaryWhitelistToContentScript',
                  error
                );
              }
              var contentScriptStatus =
                response && response.status ? response.status : null;
              calculateTabStatus(activeTab, contentScriptStatus, function(
                newStatus
              ) {
                setIconStatus(newStatus, activeTab.id);
                //This is a hotfix for issue #723
                if (
                  newStatus === 'tempWhitelist' &&
                  activeTab.autoDiscardable
                ) {
                  chrome.tabs.update(activeTab.id, {
                    autoDiscardable: false,
                  });
                }
                if (callback) callback(newStatus);
              });
            }
          );
        } else if (
          status === gsUtils.STATUS_TEMPWHITELIST ||
          status === gsUtils.STATUS_FORMINPUT
        ) {
          gsMessages.sendUndoTemporaryWhitelistToContentScript(
            activeTab.id,
            function(error, response) {
              if (error) {
                gsUtils.warning(
                  activeTab.id,
                  'Failed to sendUndoTemporaryWhitelistToContentScript',
                  error
                );
              }
              var contentScriptStatus =
                response && response.status ? response.status : null;
              calculateTabStatus(activeTab, contentScriptStatus, function(
                newStatus
              ) {
                setIconStatus(newStatus, activeTab.id);
                //This is a hotfix for issue #723
                if (
                  newStatus !== 'tempWhitelist' &&
                  !activeTab.autoDiscardable
                ) {
                  chrome.tabs.update(activeTab.id, {
                    //async
                    autoDiscardable: true,
                  });
                }
                if (callback) callback(newStatus);
              });
            }
          );
        } else {
          if (callback) callback(status);
        }
      });
    });
  }

  function openLinkInSuspendedTab(parentTab, linkedUrl) {
    //imitate chromes 'open link in new tab' behaviour in how it selects the correct index
    chrome.tabs.query({ windowId: chrome.windows.WINDOW_ID_CURRENT }, function(
      tabs
    ) {
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
      chrome.tabs.create(newTabProperties, function(tab) {
        setTabFlagForTabId(tab.id, SPAWNED_TAB_CREATE_TIMESTAMP, Date.now());
      });
    });
  }

  function toggleSuspendedStateOfHighlightedTab() {
    getCurrentlyActiveTab(function(activeTab) {
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
    getCurrentlyActiveTab(function(activeTab) {
      if (activeTab) {
        gsSuspendManager.queueTabForSuspension(activeTab, 1);
      }
    });
  }

  function unsuspendHighlightedTab() {
    getCurrentlyActiveTab(function(activeTab) {
      if (activeTab && gsUtils.isSuspendedTab(activeTab)) {
        unsuspendTab(activeTab);
      }
    });
  }

  function suspendAllTabs(force) {
    const forceLevel = force ? 1 : 2;
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      if (tabs.length === 0) {
        return;
      }
      var curWindowId = tabs[0].windowId;
      chrome.windows.get(curWindowId, { populate: true }, function(curWindow) {
        curWindow.tabs.forEach(function(tab) {
          if (!tab.active) {
            gsSuspendManager.queueTabForSuspension(tab, forceLevel);
          }
        });
      });
    });
  }

  function suspendAllTabsInAllWindows(force) {
    const forceLevel = force ? 1 : 2;
    chrome.tabs.query({}, function(tabs) {
      tabs.forEach(function(currentTab) {
        gsSuspendManager.queueTabForSuspension(currentTab, forceLevel);
      });
    });
  }

  function unsuspendAllTabs() {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      if (tabs.length === 0) {
        return;
      }
      var curWindowId = tabs[0].windowId;
      chrome.windows.get(curWindowId, { populate: true }, function(curWindow) {
        curWindow.tabs.forEach(function(currentTab) {
          gsSuspendManager.unqueueTabForSuspension(currentTab);
          if (gsUtils.isSuspendedTab(currentTab)) {
            unsuspendTab(currentTab);
          } else if (
            gsUtils.isNormalTab(currentTab) &&
            !gsUtils.isDiscardedTab(currentTab)
          ) {
            gsMessages.sendRestartTimerToContentScript(currentTab.id); //async. unhandled error
          }
        });
      });
    });
  }

  function unsuspendAllTabsInAllWindows() {
    chrome.windows.getCurrent({}, function(currentWindow) {
      chrome.tabs.query({}, function(tabs) {
        // Because of the way that unsuspending steals window focus, we defer the suspending of tabs in the
        // current window until last
        var deferredTabs = [];
        tabs.forEach(function(tab) {
          gsSuspendManager.unqueueTabForSuspension(tab);
          if (gsUtils.isSuspendedTab(tab)) {
            if (tab.windowId === currentWindow.id) {
              deferredTabs.push(tab);
            } else {
              unsuspendTab(tab);
            }
          } else if (gsUtils.isNormalTab(tab) && !gsUtils.isDiscardedTab(tab)) {
            gsMessages.sendRestartTimerToContentScript(tab.id); //async. unhandled error
          }
        });
        deferredTabs.forEach(function(tab) {
          unsuspendTab(tab);
        });
      });
    });
  }

  function suspendSelectedTabs() {
    chrome.tabs.query({ highlighted: true, lastFocusedWindow: true }, function(
      selectedTabs
    ) {
      selectedTabs.forEach(function(tab) {
        gsSuspendManager.queueTabForSuspension(tab, 1);
      });
    });
  }

  function unsuspendSelectedTabs() {
    chrome.tabs.query({ highlighted: true, lastFocusedWindow: true }, function(
      selectedTabs
    ) {
      selectedTabs.forEach(function(tab) {
        gsSuspendManager.unqueueTabForSuspension(tab);
        if (gsUtils.isSuspendedTab(tab)) {
          unsuspendTab(tab);
        }
      });
    });
  }

  function resuspendSuspendedTab(tab) {
    gsMessages.sendDisableUnsuspendOnReloadToSuspendedTab(tab.id, function(
      error
    ) {
      if (error) {
        gsUtils.warning(
          tab.id,
          'Failed to sendDisableUnsuspendOnReloadToSuspendedTab',
          error
        );
      } else {
        chrome.tabs.reload(tab.id);
      }
    });
  }

  function queueSessionTimer() {
    clearTimeout(_sessionSaveTimer);
    _sessionSaveTimer = setTimeout(function() {
      gsUtils.log('background', 'updating current session');
      gsSession.updateCurrentSession(); //async
    }, 1000);
  }

  //tab flags allow us to flag a tab id to execute specific behaviour on load/reload
  //all tab flags are cleared when the tab id receives changeInfo.status === 'complete' or tab is removed
  function getTabFlagForTabId(tabId, tabFlag) {
    return _tabFlagsByTabId[tabId]
      ? _tabFlagsByTabId[tabId][tabFlag]
      : undefined;
  }
  function setTabFlagForTabId(tabId, tabFlag, flagValue) {
    gsUtils.log(tabId, `Setting tabFlag: ${tabFlag}=${flagValue}`);
    var tabFlags = _tabFlagsByTabId[tabId] || {};
    tabFlags[tabFlag] = flagValue;
    _tabFlagsByTabId[tabId] = tabFlags;
  }
  function clearTabFlagsForTabId(tabId) {
    delete _tabFlagsByTabId[tabId];
  }

  function unsuspendTab(tab) {
    if (!gsUtils.isSuspendedTab(tab)) return;

    // If the suspended tab is discarded then reload the tab directly.
    // This will happen if the 'discard suspended tabs' option is turned on and the tab
    // is being unsuspended remotely.
    // Reloading directly causes a history item for the suspended tab to be made in the tab history.
    // It will also break temp whitelisting of a suspended tab (currently not implemented anyway)
    if (gsUtils.isDiscardedTab(tab)) {
      chrome.tabs.update(tab.id, { url: gsUtils.getSuspendedUrl(tab.url) });
      return;
    }

    gsMessages.sendUnsuspendRequestToSuspendedTab(tab.id, function(error) {
      if (error) {
        gsUtils.warning(
          tab.id,
          'Failed to sendUnsuspendRequestToSuspendedTab',
          error
        );
        let url = gsUtils.getSuspendedUrl(tab.url);
        if (url) {
          gsUtils.log(tab.id, 'Will reload directly.');
          chrome.tabs.update(tab.id, { url: url });
        }
      }
    });
  }

  function getSuspendUnsuspendHotkey(callback) {
    if (_suspendUnsuspendHotkey) {
      callback(_suspendUnsuspendHotkey);
      return;
    }
    resetSuspendUnsuspendHotkey(function(hotkeyChanged) {
      callback(_suspendUnsuspendHotkey);
    });
  }

  function resetSuspendUnsuspendHotkey(callback) {
    gsUtils.buildSuspendUnsuspendHotkey(function(hotkey) {
      var hotkeyChanged = hotkey !== _suspendUnsuspendHotkey;
      _suspendUnsuspendHotkey = hotkey;
      callback(hotkeyChanged);
    });
  }

  function updateSuspendUnsuspendHotkey() {
    resetSuspendUnsuspendHotkey(function(hotkeyChanged) {
      if (hotkeyChanged) {
        getSuspendUnsuspendHotkey(function(hotkey) {
          gsMessages.sendRefreshToAllSuspendedTabs({
            //async
            command: hotkey,
          });
        });
      }
    });
  }

  function handleUnsuspendedTabChanged(tab, changeInfo) {
    var hasTabStatusChanged = false;

    //check if tab has just been discarded
    if (changeInfo.hasOwnProperty('discarded') && changeInfo.discarded) {
      const existingSuspendReason = getTabFlagForTabId(tab.id, SUSPEND_REASON);
      if (existingSuspendReason && existingSuspendReason === 3) {
        // For some reason the discarded changeInfo gets called twice (chrome bug?)
        // As a workaround we use the suspend reason to determine if we've already
        // handled this discard
        //TODO: Report chrome bug
        return;
      }
      gsUtils.log(tab.id, 'Tab has been discarded. Url: ' + tab.url);
      gsSuspendManager.handleDiscardedUnsuspendedTab(tab, false); // async. unhandled promise.

      // When a tab is discarded the tab id changes. We need up-to-date ids
      // in the current session otherwise crash recovery will not work
      queueSessionTimer();
      return;
    }

    //check for change in tabs audible status
    if (changeInfo.hasOwnProperty('audible')) {
      //reset tab timer if tab has just finished playing audio
      if (!changeInfo.audible && gsStorage.getOption(gsStorage.IGNORE_AUDIO)) {
        gsMessages.sendRestartTimerToContentScript(tab.id); //async. unhandled error
      }
      hasTabStatusChanged = true;
    }
    if (changeInfo.hasOwnProperty('pinned')) {
      //reset tab timer if tab has become unpinned
      if (!changeInfo.pinned && gsStorage.getOption(gsStorage.IGNORE_PINNED)) {
        gsMessages.sendRestartTimerToContentScript(tab.id); //async. unhandled error
      }
      hasTabStatusChanged = true;
    }

    //if page has finished loading
    if (changeInfo.status === 'complete') {
      var spawnedTabCreateTimestamp = getTabFlagForTabId(
        tab.id,
        SPAWNED_TAB_CREATE_TIMESTAMP
      );
      //safety check that only allows tab to auto suspend if it has been less than 300 seconds since spawned tab created
      if (
        spawnedTabCreateTimestamp &&
        (Date.now() - spawnedTabCreateTimestamp) / 1000 < 300
      ) {
        gsUtils.log(tab.id, 'Suspending tab with a spawnedTabCreateTimestamp');
        gsSuspendManager.queueTabForSuspension(tab, 1);
        return;
      }

      //init loaded tab
      initialiseUnsuspendedTabAsPromised(tab)
        .then(() => {
          // unhandled async (could use returned tab status here below)
        })
        .catch(error => {
          gsUtils.warning(
            tab.id,
            'Failed to send init to content script. Tab may not behave as expected.'
          );
        });
      clearTabFlagsForTabId(tab.id);
      hasTabStatusChanged = true;
    }

    //if tab is currently visible then update popup icon
    if (hasTabStatusChanged && isCurrentFocusedTab(tab)) {
      calculateTabStatus(tab, null, function(status) {
        setIconStatus(status, tab.id);
      });
    }
  }

  function initialiseUnsuspendedTabAsPromised(tab) {
    return new Promise((resolve, reject) => {
      var ignoreForms = gsStorage.getOption(gsStorage.IGNORE_FORMS);
      var isTempWhitelist = getTabFlagForTabId(
        tab.id,
        TEMP_WHITELIST_ON_RELOAD
      );
      var scrollPos = getTabFlagForTabId(tab.id, SCROLL_POS) || null;
      var suspendTime = gsUtils.isProtectedActiveTab(tab)
        ? '0'
        : gsStorage.getOption(gsStorage.SUSPEND_TIME);
      gsMessages.sendInitTabToContentScript(
        tab.id,
        ignoreForms,
        isTempWhitelist,
        scrollPos,
        suspendTime,
        function(error, response) {
          if (error) {
            reject(error);
          } else {
            resolve(response);
          }
        }
      );
    });
  }

  function handleSuspendedTabChanged(tab, changeInfo, unsuspendOnReloadUrl) {
    //if a suspended tab is being reloaded, we may want to actually unsuspend it instead
    //if the UNSUSPEND_ON_RELOAD_URL flag is matches the current url, then unsuspend.
    if (changeInfo.status === 'loading') {
      if (unsuspendOnReloadUrl && unsuspendOnReloadUrl === tab.url) {
        unsuspendTab(tab);
      }

      // If we want to force tabs to be discarded after suspending them
      let discardAfterSuspend = gsStorage.getOption(
        gsStorage.DISCARD_AFTER_SUSPEND
      );
      if (discardAfterSuspend) {
        setTabFlagForTabId(tab.id, DISCARD_ON_LOAD, true);
      }
    } else if (changeInfo.status === 'complete') {
      initialiseSuspendedTabAsPromised(tab)
        .then(function() {
          let discardOnLoad = getTabFlagForTabId(tab.id, DISCARD_ON_LOAD);
          clearTabFlagsForTabId(tab.id);
          gsSuspendManager.markTabAsSuspended(tab);

          if (isCurrentFocusedTab(tab)) {
            setIconStatus(gsUtils.STATUS_SUSPENDED, tab.id);
          }

          // Set scrollPosition tab flag
          const scrollPosition = gsUtils.getSuspendedScrollPosition(tab.url);
          setTabFlagForTabId(tab.id, SCROLL_POS, scrollPosition);

          // If we want to discard tabs after suspending them
          let discardAfterSuspend = gsStorage.getOption(
            gsStorage.DISCARD_AFTER_SUSPEND
          );
          if (discardAfterSuspend && !tab.active && discardOnLoad) {
            gsSuspendManager.forceTabDiscardation(tab);
          }
        })
        .catch(error => {
          gsUtils.warning(
            tab.id,
            'Failed to initialiseSuspendedTabAsPromise. Suspended tab may not behave as expected.',
            error
          );
        });
    }
  }

  function initialiseSuspendedTabAsPromised(tab) {
    return new Promise(async (resolve, reject) => {
      const suspendedUrl = tab.url;
      const originalUrl = gsUtils.getSuspendedUrl(suspendedUrl);
      const whitelisted = gsUtils.checkWhiteList(originalUrl);
      const tabProperties = await gsIndexedDb.fetchTabInfo(originalUrl);
      const favicon =
        (tabProperties && tabProperties.favicon) ||
        'chrome://favicon/' + originalUrl;
      let title =
        (tabProperties && tabProperties.title) ||
        gsUtils.getSuspendedTitle(suspendedUrl);
      if (title.indexOf('<') >= 0) {
        // Encode any raw html tags that might be used in the title
        title = gsUtils.htmlEncode(title);
      }
      const preview = await gsIndexedDb.fetchPreviewImage(originalUrl);
      let previewUri = null;
      if (
        preview &&
        preview.img &&
        preview.img !== null &&
        preview.img !== 'data:,' &&
        preview.img.length > 10000
      ) {
        previewUri = preview.img;
      }
      const options = gsStorage.getSettings();
      getSuspendUnsuspendHotkey(function(hotkey) {
        var payload = {
          tabId: tab.id,
          requestUnsuspendOnReload: true,
          url: originalUrl,
          favicon: favicon,
          title: title,
          whitelisted: whitelisted,
          theme: options[gsStorage.THEME],
          hideNag: options[gsStorage.NO_NAG],
          previewMode: options[gsStorage.SCREEN_CAPTURE],
          previewUri: previewUri,
          command: hotkey,
        };
        const suspendReason = getTabFlagForTabId(tab.id, SUSPEND_REASON);
        if (suspendReason === 3) {
          payload.reason = chrome.i18n.getMessage('js_suspended_low_memory');
        }
        gsMessages.sendInitSuspendedTab(tab.id, payload, function(
          error,
          response
        ) {
          if (error) {
            reject(error);
          } else {
            resolve(response);
          }
        });
      });
    });
  }

  function updateTabIdReferences(newTabId, oldTabId) {
    for (const windowId of Object.keys(_currentFocusedTabIdByWindowId)) {
      if (_currentFocusedTabIdByWindowId[windowId] === oldTabId) {
        _currentFocusedTabIdByWindowId[windowId] = newTabId;
      }
    }
    for (const windowId of Object.keys(_currentStationaryTabIdByWindowId)) {
      if (_currentStationaryTabIdByWindowId[windowId] === oldTabId) {
        _currentStationaryTabIdByWindowId[windowId] = newTabId;
      }
    }
    if (_tabFlagsByTabId[oldTabId]) {
      _tabFlagsByTabId[newTabId] = _tabFlagsByTabId[oldTabId];
      delete _tabFlagsByTabId[oldTabId];
    }
  }

  function handleWindowFocusChanged(windowId) {
    if (windowId < 0) {
      return;
    }
    gsUtils.log(windowId, 'window changed');
    _currentFocusedWindowId = windowId;

    // Get the active tab in the newly focused window
    chrome.tabs.query({ active: true }, function(tabs) {
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

      //update icon
      calculateTabStatus(focusedTab, null, function(status) {
        setIconStatus(status, focusedTab.id);
      });

      //pause for a bit before assuming we're on a new window as some users
      //will key through intermediate windows to get to the one they want.
      queueNewWindowFocusTimer(focusedTab.id, windowId, focusedTab);
    });
  }

  function handleTabFocusChanged(tabId, windowId) {
    gsUtils.log(tabId, 'tab gained focus');
    _currentFocusedTabIdByWindowId[windowId] = tabId;

    // If the tab focused before this was the keyboard shortcuts page, then update hotkeys on suspended pages
    if (_triggerHotkeyUpdate) {
      updateSuspendUnsuspendHotkey();
      _triggerHotkeyUpdate = false;
    }

    chrome.tabs.get(tabId, function(tab) {
      if (chrome.runtime.lastError) {
        gsUtils.warning(
          tabId,
          chrome.runtime.lastError,
          `Failed find newly focused tab with id: ${tabId}. Tab may have been closed.`
        );
        return;
      }

      //update icon
      calculateTabStatus(tab, null, function(status) {
        setIconStatus(status, tab.id);
      });

      //pause for a bit before assuming we're on a new tab as some users
      //will key through intermediate tabs to get to the one they want.
      queueNewTabFocusTimer(tabId, windowId, tab);

      // test for a save of keyboard shortcuts (chrome://extensions/shortcuts)
      if (tab.url === 'chrome://extensions/shortcuts') {
        _triggerHotkeyUpdate = true;
      }
    });
  }

  function queueNewWindowFocusTimer(tabId, windowId, focusedTab) {
    clearTimeout(_newWindowFocusTimer);
    _newWindowFocusTimer = setTimeout(function() {
      var previousStationaryWindowId = _currentStationaryWindowId;
      _currentStationaryWindowId = windowId;
      var previousStationaryTabId =
        _currentStationaryTabIdByWindowId[previousStationaryWindowId];
      handleNewStationaryTabFocus(tabId, previousStationaryTabId, focusedTab);
    }, FOCUS_DELAY);
  }

  function queueNewTabFocusTimer(tabId, windowId, focusedTab) {
    clearTimeout(_newTabFocusTimer);
    _newTabFocusTimer = setTimeout(function() {
      var previousStationaryTabId = _currentStationaryTabIdByWindowId[windowId];
      _currentStationaryTabIdByWindowId[windowId] = focusedTab.id;
      handleNewStationaryTabFocus(tabId, previousStationaryTabId, focusedTab);
    }, FOCUS_DELAY);
  }

  function handleNewStationaryTabFocus(
    tabId,
    previousStationaryTabId,
    focusedTab
  ) {
    gsUtils.log(tabId, 'new tab focus handled');
    //remove request to instantly suspend this tab id
    if (getTabFlagForTabId(tabId, SPAWNED_TAB_CREATE_TIMESTAMP)) {
      setTabFlagForTabId(tabId, SPAWNED_TAB_CREATE_TIMESTAMP, false);
    }

    if (gsUtils.isSuspendedTab(focusedTab)) {
      var autoUnsuspend = gsStorage.getOption(gsStorage.UNSUSPEND_ON_FOCUS);
      if (autoUnsuspend) {
        if (navigator.onLine) {
          unsuspendTab(focusedTab);
        } else {
          gsMessages.sendNoConnectivityMessageToSuspendedTab(focusedTab.id); //async. unhandled error
        }
      }
    } else if (gsUtils.isNormalTab(focusedTab)) {
      //clear timer on newly focused tab
      if (
        focusedTab.status === 'complete' &&
        !gsUtils.isDiscardedTab(focusedTab)
      ) {
        gsMessages.sendClearTimerToContentScript(tabId); //async. unhandled error
      }

      //if tab is already in the queue for suspension then remove it.
      //although sometimes it seems that this is a 'fake' tab focus resulting
      //from the popup menu disappearing. in these cases the previousStationaryTabId
      //should match the current tabId (fix for issue #735)
      if (previousStationaryTabId && previousStationaryTabId !== tabId) {
        gsSuspendManager.unqueueTabForSuspension(focusedTab);
      } else {
        gsUtils.log(
          tabId,
          'Will not abort suspension for this tab as it matches previousStationaryTabId'
        );
      }
    } else if (focusedTab.url === chrome.extension.getURL('options.html')) {
      gsMessages.sendReloadOptionsToOptionsTab(focusedTab.id); //async. unhandled error
    }

    //Perhaps this check could apply to the whole function?
    if (previousStationaryTabId && previousStationaryTabId !== tabId) {
      chrome.tabs.get(previousStationaryTabId, function(previousStationaryTab) {
        if (chrome.runtime.lastError) {
          //Tab has probably been removed
          return;
        }

        //Reset timer on tab that lost focus.
        //NOTE: This may be due to a change in window focus in which case the tab may still have .active = true
        if (
          previousStationaryTab &&
          gsUtils.isNormalTab(previousStationaryTab) &&
          !gsUtils.isProtectedActiveTab(previousStationaryTab) &&
          !gsUtils.isDiscardedTab(previousStationaryTab)
        ) {
          gsMessages.sendRestartTimerToContentScript(previousStationaryTab.id); //async. unhandled error
        }

        //if discarding strategy is to discard tabs after suspending them, and the
        //previousStationaryTab is suspended, then discard it again.
        if (gsUtils.isSuspendedTab(previousStationaryTab)) {
          let discardAfterSuspend = gsStorage.getOption(
            gsStorage.DISCARD_AFTER_SUSPEND
          );
          var discardOnLoad = getTabFlagForTabId(
            previousStationaryTabId,
            DISCARD_ON_LOAD
          );
          if (discardAfterSuspend && !discardOnLoad) {
            gsSuspendManager.forceTabDiscardation(previousStationaryTab);
          }
        }
      });
    }
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

  function getDebugInfo(tabId, callback) {
    var info = {
      windowId: '',
      tabId: '',
      status: gsUtils.STATUS_UNKNOWN,
      timerUp: '-',
    };

    chrome.tabs.get(tabId, function(tab) {
      if (chrome.runtime.lastError) {
        gsUtils.error(tabId, chrome.runtime.lastError);
        callback(info);
        return;
      }

      info.windowId = tab.windowId;
      info.tabId = tab.id;
      if (gsUtils.isNormalTab(tab) && !gsUtils.isDiscardedTab(tab)) {
        gsMessages.sendRequestInfoToContentScript(tab.id, function(
          error,
          tabInfo
        ) {
          if (error) {
            gsUtils.warning(tab.id, 'Failed to getDebugInfo', error);
          }
          if (tabInfo) {
            info.timerUp = tabInfo.timerUp;
            calculateTabStatus(tab, tabInfo.status, function(status) {
              info.status = status;
              callback(info);
            });
          } else {
            callback(info);
          }
        });
      } else {
        calculateTabStatus(tab, null, function(status) {
          info.status = status;
          callback(info);
        });
      }
    });
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
  function calculateTabStatus(tab, knownContentScriptStatus, callback) {
    //check for loading
    if (tab.status === 'loading') {
      callback(gsUtils.STATUS_LOADING);
      return;
    }
    //check if it is a special tab
    if (gsUtils.isSpecialTab(tab)) {
      callback(gsUtils.STATUS_SPECIAL);
      return;
    }
    //check if tab has been discarded
    if (gsUtils.isDiscardedTab(tab)) {
      callback(gsUtils.STATUS_DISCARDED);
      return;
    }
    //check if it has already been suspended
    if (gsUtils.isSuspendedTab(tab)) {
      callback(gsUtils.STATUS_SUSPENDED);
      return;
    }
    //check whitelist
    if (gsUtils.checkWhiteList(tab.url)) {
      callback(gsUtils.STATUS_WHITELISTED);
      return;
    }
    //check never suspend
    //should come after whitelist check as it causes popup to show the whitelisting option
    if (gsStorage.getOption(gsStorage.SUSPEND_TIME) === '0') {
      callback(gsUtils.STATUS_NEVER);
      return;
    }
    getContentScriptStatus(tab.id, knownContentScriptStatus).then(function(
      contentScriptStatus
    ) {
      if (
        contentScriptStatus &&
        contentScriptStatus !== gsUtils.STATUS_NORMAL
      ) {
        callback(contentScriptStatus);
        return;
      }
      //check running on battery
      if (gsStorage.getOption(gsStorage.IGNORE_WHEN_CHARGING) && _isCharging) {
        callback(gsUtils.STATUS_CHARGING);
        return;
      }
      //check internet connectivity
      if (
        gsStorage.getOption(gsStorage.IGNORE_WHEN_OFFLINE) &&
        !navigator.onLine
      ) {
        callback(gsUtils.STATUS_NOCONNECTIVITY);
        return;
      }
      //check pinned tab
      if (gsUtils.isProtectedPinnedTab(tab)) {
        callback(gsUtils.STATUS_PINNED);
        return;
      }
      //check audible tab
      if (gsUtils.isProtectedAudibleTab(tab)) {
        callback(gsUtils.STATUS_AUDIBLE);
        return;
      }
      //check active
      if (gsUtils.isProtectedActiveTab(tab)) {
        callback(gsUtils.STATUS_ACTIVE);
        return;
      }
      if (contentScriptStatus) {
        callback(contentScriptStatus); // should be 'normal'
        return;
      }
      callback(gsUtils.STATUS_UNKNOWN);
    });
  }

  function getActiveTabStatus(callback) {
    getCurrentlyActiveTab(function(tab) {
      if (!tab) {
        callback(gsUtils.STATUS_UNKNOWN);
        return;
      }
      calculateTabStatus(tab, null, function(status) {
        callback(status);
      });
    });
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
          'background',
          chrome.runtime.lastError,
          `Failed to set icon for tabId: ${tabId}. Tab may have been closed.`
        );
      }
    });
  }

  function setIconStatusForActiveTab() {
    getCurrentlyActiveTab(function(tab) {
      if (!tab) {
        return;
      }
      calculateTabStatus(tab, null, function(status) {
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
        title: chrome.i18n.getMessage('js_context_open_link_in_suspended_tab'),
        contexts: ['link'],
        onclick: function(info, tab) {
          openLinkInSuspendedTab(tab, info.linkUrl);
        },
      });

      chrome.contextMenus.create({
        title: chrome.i18n.getMessage('js_context_toggle_suspend_state'),
        contexts: allContexts,
        onclick: toggleSuspendedStateOfHighlightedTab,
      });
      chrome.contextMenus.create({
        title: chrome.i18n.getMessage('js_context_toggle_pause_suspension'),
        contexts: allContexts,
        onclick: toggleTempWhitelistStateOfHighlightedTab,
      });
      chrome.contextMenus.create({
        title: chrome.i18n.getMessage('js_context_never_suspend_page'),
        contexts: allContexts,
        onclick: () => whitelistHighlightedTab(true),
      });
      chrome.contextMenus.create({
        title: chrome.i18n.getMessage('js_context_never_suspend_domain'),
        contexts: allContexts,
        onclick: () => whitelistHighlightedTab(false),
      });

      chrome.contextMenus.create({
        contexts: allContexts,
        type: 'separator',
      });

      chrome.contextMenus.create({
        title: chrome.i18n.getMessage('js_context_suspend_selected_tabs'),
        contexts: allContexts,
        onclick: suspendSelectedTabs,
      });
      chrome.contextMenus.create({
        title: chrome.i18n.getMessage('js_context_unsuspend_selected_tabs'),
        contexts: allContexts,
        onclick: unsuspendSelectedTabs,
      });

      chrome.contextMenus.create({
        contexts: allContexts,
        type: 'separator',
      });

      chrome.contextMenus.create({
        title: chrome.i18n.getMessage(
          'js_context_soft_suspend_other_tabs_in_window'
        ),
        contexts: allContexts,
        onclick: () => suspendAllTabs(false),
      });
      chrome.contextMenus.create({
        title: chrome.i18n.getMessage(
          'js_context_force_suspend_other_tabs_in_window'
        ),
        contexts: allContexts,
        onclick: () => suspendAllTabs(true),
      });
      chrome.contextMenus.create({
        title: chrome.i18n.getMessage(
          'js_context_unsuspend_all_tabs_in_window'
        ),
        contexts: allContexts,
        onclick: unsuspendAllTabs,
      });

      chrome.contextMenus.create({
        contexts: allContexts,
        type: 'separator',
      });

      chrome.contextMenus.create({
        title: chrome.i18n.getMessage('js_context_soft_suspend_all_tabs'),
        contexts: allContexts,
        onclick: () => suspendAllTabsInAllWindows(false),
      });
      chrome.contextMenus.create({
        title: chrome.i18n.getMessage('js_context_force_suspend_all_tabs'),
        contexts: allContexts,
        onclick: () => suspendAllTabsInAllWindows(true),
      });
      chrome.contextMenus.create({
        title: chrome.i18n.getMessage('js_context_unsuspend_all_tabs'),
        contexts: allContexts,
        onclick: unsuspendAllTabsInAllWindows,
      });
    }
  }

  //HANDLERS FOR KEYBOARD SHORTCUTS

  function addCommandListeners() {
    chrome.commands.onCommand.addListener(function(command) {
      if (command === '1-suspend-tab') {
        toggleSuspendedStateOfHighlightedTab();
      } else if (command === '2-toggle-temp-whitelist-tab') {
        toggleTempWhitelistStateOfHighlightedTab();
      } else if (command === '2a-suspend-selected-tabs') {
        suspendSelectedTabs();
      } else if (command === '2b-unsuspend-selected-tabs') {
        unsuspendSelectedTabs();
      } else if (command === '3-suspend-active-window') {
        suspendAllTabs(false);
      } else if (command === '3b-force-suspend-active-window') {
        suspendAllTabs(true);
      } else if (command === '4-unsuspend-active-window') {
        unsuspendAllTabs();
      } else if (command === '4b-soft-suspend-all-windows') {
        suspendAllTabsInAllWindows(false);
      } else if (command === '5-suspend-all-windows') {
        suspendAllTabsInAllWindows(true);
      } else if (command === '6-unsuspend-all-windows') {
        unsuspendAllTabsInAllWindows();
      }
    });
  }

  //HANDLERS FOR CONTENT SCRIPT MESSAGE REQUESTS

  function contentScriptMessageRequestListener(request, sender, sendResponse) {
    gsUtils.log(
      sender.tab.id,
      'contentScriptMessageRequestListener',
      request.action
    );

    switch (request.action) {
      case 'reportTabState':
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
        if (sender.tab && isCurrentFocusedTab(sender.tab)) {
          calculateTabStatus(sender.tab, contentScriptStatus, function(status) {
            setIconStatus(status, sender.tab.id);
          });
        }
        break;

      case 'suspendTab':
        gsSuspendManager.queueTabForSuspension(sender.tab, 3);
        break;

      case 'savePreviewData':
        if (request.previewUrl) {
          gsIndexedDb
            .addPreviewImage(sender.tab.url, request.previewUrl)
            .then(() => gsSuspendManager.executeTabSuspension(sender.tab));
        } else {
          gsUtils.warning(
            'savePreviewData reported an error: ' + request.errorMsg
          );
          gsSuspendManager.executeTabSuspension(sender.tab);
        }
        break;
    }
    sendResponse();
    return false;
  }

  function addChromeListeners() {
    //attach listener to runtime
    chrome.runtime.onMessage.addListener(contentScriptMessageRequestListener);
    //attach listener to runtime for external messages, to allow
    //interoperability with other extensions in the manner of an API
    chrome.runtime.onMessageExternal.addListener(
      contentScriptMessageRequestListener
    );

    chrome.windows.onFocusChanged.addListener(function(windowId) {
      handleWindowFocusChanged(windowId);
    });
    chrome.tabs.onActivated.addListener(function(activeInfo) {
      handleTabFocusChanged(activeInfo.tabId, activeInfo.windowId);
    });
    chrome.tabs.onReplaced.addListener(function(addedTabId, removedTabId) {
      updateTabIdReferences(addedTabId, removedTabId);
    });
    chrome.tabs.onCreated.addListener(function(tab) {
      gsUtils.log(tab.id, 'tab created. tabUrl: ' + tab.url);
      queueSessionTimer();
    });
    chrome.tabs.onRemoved.addListener(function(tabId, removeInfo) {
      gsUtils.log(tabId, 'tab removed.');
      queueSessionTimer();
      clearTabFlagsForTabId(tabId);
    });
    chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
      if (!changeInfo) return;
      if (
        !changeInfo.hasOwnProperty('url') &&
        !changeInfo.hasOwnProperty('status') &&
        !changeInfo.hasOwnProperty('audible') &&
        !changeInfo.hasOwnProperty('pinned') &&
        !changeInfo.hasOwnProperty('discarded')
      ) {
        return;
      }

      gsUtils.log(tabId, 'tab updated. changeInfo: ', changeInfo);

      // if url has changed
      if (changeInfo.url) {
        // test for special case of a successful donation
        if (changeInfo.url === 'https://greatsuspender.github.io/thanks.html') {
          gsStorage.setOption(gsStorage.NO_NAG, true);
          gsAnalytics.reportEvent('Donations', 'HidePopupAuto', true);
          chrome.tabs.update(tabId, {
            url: chrome.extension.getURL('thanks.html'),
          });

          // test for a save of keyboard shortcuts (chrome://extensions/shortcuts)
        } else if (changeInfo.url === 'chrome://extensions/shortcuts') {
          _triggerHotkeyUpdate = true;
        }
        queueSessionTimer();
      }

      let unsuspendOnReloadUrl = getTabFlagForTabId(
        tab.id,
        UNSUSPEND_ON_RELOAD_URL
      );
      if (unsuspendOnReloadUrl) {
        setTabFlagForTabId(tab.id, UNSUSPEND_ON_RELOAD_URL, null);
      }
      if (gsUtils.isSuspendedTab(tab, true)) {
        handleSuspendedTabChanged(tab, changeInfo, unsuspendOnReloadUrl);
      } else if (gsUtils.isNormalTab(tab)) {
        handleUnsuspendedTabChanged(tab, changeInfo);
      }
    });
    chrome.windows.onCreated.addListener(function(window) {
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
    chrome.windows.onRemoved.addListener(function() {
      gsUtils.log('background', 'window removed.');
      queueSessionTimer();
    });

    //tidy up history items as they are created
    //NOTE: This only affects tab history, and has no effect on chrome://history
    //It is also impossible to remove a the first tab history entry for a tab
    chrome.history.onVisited.addListener(function(historyItem) {
      if (gsUtils.isSuspendedUrl(historyItem.url, true)) {
        //remove suspended tab history item
        chrome.history.deleteUrl({ url: historyItem.url });
      }
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
          setIconStatusForActiveTab();
          //restart timer on all normal tabs
          //NOTE: some tabs may have been prevented from suspending when computer was charging
          if (
            !_isCharging &&
            gsStorage.getOption(gsStorage.IGNORE_WHEN_CHARGING)
          ) {
            gsMessages.sendResetTimerToAllContentScripts(); //async. unhandled error
          }
        };
      });
    }

    //add listeners for online/offline state changes
    window.addEventListener('online', function() {
      gsUtils.log('background', 'Internet is online.');
      //restart timer on all normal tabs
      //NOTE: some tabs may have been prevented from suspending when internet was offline
      if (gsStorage.getOption(gsStorage.IGNORE_WHEN_OFFLINE)) {
        gsMessages.sendResetTimerToAllContentScripts(); //async. unhandled error
      }
      setIconStatusForActiveTab();
    });
    window.addEventListener('offline', function() {
      gsUtils.log('background', 'Internet is offline.');
      setIconStatusForActiveTab();
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
    TEMP_WHITELIST_ON_RELOAD,
    UNSUSPEND_ON_RELOAD_URL,
    DISCARD_ON_LOAD,
    SUSPEND_REASON,
    SCROLL_POS,
    getTabFlagForTabId,
    setTabFlagForTabId,

    backgroundScriptsReadyAsPromised,
    initAsPromised,
    startTimers,
    requestNotice,
    clearNotice,
    buildContextMenu,
    resuspendSuspendedTab,
    getActiveTabStatus,
    getDebugInfo,
    calculateTabStatus,
    isCharging,
    isCurrentStationaryTab,
    isCurrentFocusedTab,

    initialiseUnsuspendedTabAsPromised,
    initialiseSuspendedTabAsPromised,
    unsuspendTab,
    unsuspendHighlightedTab,
    unwhitelistHighlightedTab,
    toggleTempWhitelistStateOfHighlightedTab,
    suspendHighlightedTab,
    suspendAllTabs,
    unsuspendAllTabs,
    suspendSelectedTabs,
    unsuspendSelectedTabs,
    whitelistHighlightedTab,
    unsuspendAllTabsInAllWindows,
  };
})();

tgs
  .backgroundScriptsReadyAsPromised()
  .then(() => gsAnalytics.initAsPromised())
  .then(() => gsStorage.initSettingsAsPromised())
  .then(() => gsSuspendManager.initAsPromised())
  .then(() => gsSession.initAsPromised())
  .then(() => gsSession.runStartupChecks()) // performs crash check (and maybe recovery)
  .then(() => gsSession.checkTabsForResponsiveness()) // performs tab responsiveness checks
  .catch(error => {
    error = error || 'Unknown error occurred during background initialisation';
    gsUtils.error('background', error);
  })
  .then(() => tgs.initAsPromised()) // adds handle(Un)SuspendedTabChanged listeners!
  .then(() => {
    return new Promise(resolve => {
      gsAnalytics.performStartupReport();
      tgs.startTimers();
      resolve();
    });
  });
