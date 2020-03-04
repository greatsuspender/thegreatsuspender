sendRequestInfoToContentScript;
/*
 * The Great Suspender
 * Copyright (C) 2017 Dean Oemcke
 * Available under GNU GENERAL PUBLIC LICENSE v2
 * http://github.com/deanoemcke/thegreatsuspender
 * ༼ つ ◕_◕ ༽つ
 */

import {
  getOption,
  setOptionAndSync,
  fetchNoticeVersion,
  ADD_CONTEXT,
  SUSPEND_TIME,
  NO_NAG,
  IGNORE_AUDIO,
  IGNORE_PINNED,
  IGNORE_FORMS,
  UNSUSPEND_ON_FOCUS,
  IGNORE_WHEN_CHARGING,
  IGNORE_WHEN_OFFLINE,
} from './gsStorage';
import {
  initialiseTabContentScript,
  sendTemporaryWhitelistToContentScript,
  sendUndoTemporaryWhitelistToContentScript,
  sendRequestInfoToContentScript,
} from './helpers/contentScripts';
import { reportEvent } from './gsAnalytics';
import {
  SUSPENDED_IFRAME_PREFIX,
  SUSPEND_URL_PREFIX,
  INTERNAL_MSG_URL,
  makeDataUrl,
  reinitialiseSuspendedTab,
  generateIframeContainerDataUrl,
  generateIframeContentsDataUrl,
  KEYBOARD_SHORTCUTS_PREFIX,
} from './actions/suspendTab';
import { reinjectContentScriptOnTab } from './helpers/contentScripts';
import {
  queueTabForSuspension,
  unqueueTabForSuspension,
  getQueuedTabDetails,
  handlePreviewImageResponse,
} from './gsTabSuspendManager';
import { queueTabCheck, queueTabCheckAsPromise } from './gsTabCheckManager';
import { updateCurrentSession } from './gsSession';
import {
  log,
  warning,
  error,
  isNormalTab,
  isSuspendedTab,
  getRootUrl,
  getOriginalUrlFromSuspendedUrl,
  saveToWhitelist,
  removeFromWhitelist,
  getScrollPositionFromSuspendedUrl,
  getSettingsHashFromSuspendedUrl,
  isBlockedFileTab,
  isSpecialTab,
  isDiscardedTab,
  checkWhiteList,
  isProtectedActiveTab,
  isProtectedPinnedTab,
  isProtectedAudibleTab,
  parseEncodedQueryString,
  hasProperty,
  STATUS_UNKNOWN,
  STATUS_LOADING,
  STATUS_SUSPENDED,
  STATUS_SPECIAL,
  STATUS_BLOCKED_FILE,
  STATUS_WHITELISTED,
  STATUS_NORMAL,
  STATUS_ACTIVE,
  STATUS_FORMINPUT,
  STATUS_CHARGING,
  STATUS_NEVER,
  STATUS_NOCONNECTIVITY,
  STATUS_PINNED,
  STATUS_TEMPWHITELIST,
  STATUS_AUDIBLE,
  STATUS_DISCARDED,
} from './gsUtils';
import {
  tabsGet,
  tabsQuery,
  tabsUpdate,
  windowsGetLastFocused,
} from './gsChrome';
import {
  getTabStatePropForTabId,
  setTabStatePropForTabId,
  clearTabStateForTabId,
  clearAutoSuspendTimerForTabId,
  updateTabStateIdReferences,
  STATE_TIMER_DETAILS,
  STATE_TEMP_WHITELIST_ON_RELOAD,
} from './gsTabState';
import {
  getScrollPosForTabId,
  setStatusForTabId,
  getStatusForTabId,
  getFaviconMetaForTabId,
  setSettingsHashForTabId,
  getSettingsHashForTabId,
} from './helpers/tabStates';
import {
  getInternalViewByTabId,
  executeViewGlobal,
  executeViewGlobalsForViewName,
  VIEW_FUNC_OPTIONS_REINIT,
} from './gsViews';
import {
  buildSuspensionToggleHotkey,
  buildSettingsStateHash,
  getSettingsStateHash,
} from './helpers/extensionState';
import { browser } from 'webextension-polyfill-ts';

const ICON_SUSPENSION_ACTIVE = {
  '16': 'img/ic_suspendy_16x16.png',
  '32': 'img/ic_suspendy_32x32.png',
};

const ICON_SUSPENSION_PAUSED = {
  '16': 'img/ic_suspendy_16x16_grey.png',
  '32': 'img/ic_suspendy_32x32_grey.png',
};

const focusDelay = 500;

const _currentFocusedTabIdByWindowId = {};
const _currentStationaryTabIdByWindowId = {};

let _currentFocusedWindowId;
let _currentStationaryWindowId;
let _sessionSaveTimer;
let _newTabFocusTimer;
let _newWindowFocusTimer;
let _noticeToDisplay;
let _isCharging = false;
let _triggerHotkeyUpdate = false;
let _suspensionToggleHotkey;

export const initAsPromised = async () => {
  log('background', 'PERFORMING BACKGROUND INIT...');
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
    const contextMenus = getOption(ADD_CONTEXT);
    buildContextMenu(contextMenus);
  }

  //initialise currentStationary and currentFocused vars
  const activeTabs = await tabsQuery({ active: true });
  const currentWindow = await windowsGetLastFocused();
  for (const activeTab of activeTabs) {
    _currentStationaryTabIdByWindowId[activeTab.windowId] = activeTab.id;
    _currentFocusedTabIdByWindowId[activeTab.windowId] = activeTab.id;
    if (currentWindow && currentWindow.id === activeTab.windowId) {
      _currentStationaryWindowId = activeTab.windowId;
      _currentFocusedWindowId = activeTab.windowId;
    }
  }
  log('background', 'init successful');
};

export const getCurrentlyActiveTab = callback => {
  // wrap this in an anonymous async function so we can use await
  (async function() {
    const currentWindowActiveTabs = await tabsQuery({
      active: true,
      currentWindow: true,
    });
    if (currentWindowActiveTabs.length > 0) {
      callback(currentWindowActiveTabs[0]);
      return;
    }

    // Fallback on chrome.windows.getLastFocused
    const lastFocusedWindow = await windowsGetLastFocused();
    if (lastFocusedWindow) {
      const lastFocusedWindowActiveTabs = await tabsQuery({
        active: true,
        windowId: lastFocusedWindow.id,
      });
      if (lastFocusedWindowActiveTabs.length > 0) {
        callback(lastFocusedWindowActiveTabs[0]);
        return;
      }
    }

    // Fallback on _currentStationaryWindowId
    if (_currentStationaryWindowId) {
      const currentStationaryWindowActiveTabs = await tabsQuery({
        active: true,
        windowId: _currentStationaryWindowId,
      });
      if (currentStationaryWindowActiveTabs.length > 0) {
        callback(currentStationaryWindowActiveTabs[0]);
        return;
      }

      // Fallback on currentStationaryTabId
      const currentStationaryTabId =
        _currentStationaryTabIdByWindowId[_currentStationaryWindowId];
      if (currentStationaryTabId) {
        const currentStationaryTab = await tabsGet(currentStationaryTabId);
        if (currentStationaryTab !== null) {
          callback(currentStationaryTab);
          return;
        }
      }
    }
    callback(null);
  })();
};

// NOTE: Stationary here means has had focus for more than focusDelay ms
// So it may not necessarily have the tab.active flag set to true
export const isCurrentStationaryTab = tab => {
  if (tab.windowId !== _currentStationaryWindowId) {
    return false;
  }
  const lastStationaryTabIdForWindow =
    _currentStationaryTabIdByWindowId[tab.windowId];
  if (lastStationaryTabIdForWindow) {
    return tab.id === lastStationaryTabIdForWindow;
  } else {
    // fallback on active flag
    return tab.active;
  }
};

export const isCurrentFocusedTab = tab => {
  if (tab.windowId !== _currentFocusedWindowId) {
    return false;
  }
  const currentFocusedTabIdForWindow =
    _currentFocusedTabIdByWindowId[tab.windowId];
  if (currentFocusedTabIdForWindow) {
    return tab.id === currentFocusedTabIdForWindow;
  } else {
    // fallback on active flag
    return tab.active;
  }
};

export const isCurrentActiveTab = tab => {
  const activeTabIdForWindow = _currentFocusedTabIdByWindowId[tab.windowId];
  if (activeTabIdForWindow) {
    return tab.id === activeTabIdForWindow;
  } else {
    // fallback on active flag
    return tab.active;
  }
};

export const whitelistHighlightedTab = includePath => {
  includePath = includePath || false;
  getCurrentlyActiveTab(function(activeTab) {
    if (activeTab) {
      if (isSuspendedTab(activeTab)) {
        const url = getRootUrl(
          getOriginalUrlFromSuspendedUrl(activeTab.url),
          includePath,
          false
        );
        saveToWhitelist(url);
        unsuspendTab(activeTab);
      } else if (isNormalTab(activeTab)) {
        const url = getRootUrl(activeTab.url, includePath, false);
        saveToWhitelist(url);
        calculateTabStatus(activeTab, null, function(status) {
          setIconStatus(status, activeTab.id);
        });
      }
    }
  });
};

export const unwhitelistHighlightedTab = callback => {
  getCurrentlyActiveTab(function(activeTab) {
    if (activeTab) {
      removeFromWhitelist(activeTab.url);
      calculateTabStatus(activeTab, null, function(status) {
        setIconStatus(status, activeTab.id);
        if (callback) callback(status);
      });
    } else {
      if (callback) callback(STATUS_UNKNOWN);
    }
  });
};

export const requestToggleTempWhitelistStateOfHighlightedTab = callback => {
  getCurrentlyActiveTab(function(activeTab) {
    if (!activeTab) {
      if (callback) callback(status);
      return;
    }
    if (isSuspendedTab(activeTab)) {
      unsuspendTab(activeTab);
      if (callback) callback(STATUS_UNKNOWN);
      return;
    }
    if (!isNormalTab(activeTab, true)) {
      if (callback) callback(STATUS_UNKNOWN);
      return;
    }

    calculateTabStatus(activeTab, null, function(status) {
      if (status === STATUS_ACTIVE || status === STATUS_NORMAL) {
        setTempWhitelistStateForTab(activeTab, callback);
      } else if (
        status === STATUS_TEMPWHITELIST ||
        status === STATUS_FORMINPUT
      ) {
        unsetTempWhitelistStateForTab(activeTab, callback);
      } else {
        if (callback) callback(status);
      }
    });
  });
};

export const setTempWhitelistStateForTab = (tab, callback) => {
  sendTemporaryWhitelistToContentScript(tab.id)
    .then(response => {
      const contentScriptStatus =
        response && response.status ? response.status : null;
      calculateTabStatus(tab, contentScriptStatus, function(newStatus) {
        setIconStatus(newStatus, tab.id);
        //This is a hotfix for issue #723
        if (newStatus === 'tempWhitelist' && tab.autoDiscardable) {
          chrome.tabs.update(tab.id, {
            autoDiscardable: false,
          });
        }
        if (callback) callback(newStatus);
      });
    })
    .catch(e => {
      warning(tab.id, 'Failed to sendTemporaryWhitelistToContentScript', e);
      if (callback) callback();
    });
};

export const unsetTempWhitelistStateForTab = (tab, callback) => {
  sendUndoTemporaryWhitelistToContentScript(tab.id)
    .then(response => {
      const contentScriptStatus =
        response && response.status ? response.status : null;
      calculateTabStatus(tab, contentScriptStatus, function(newStatus) {
        setIconStatus(newStatus, tab.id);
        //This is a hotfix for issue #723
        if (newStatus !== 'tempWhitelist' && !tab.autoDiscardable) {
          chrome.tabs.update(tab.id, {
            //async
            autoDiscardable: true,
          });
        }
        if (callback) callback(newStatus);
      });
    })
    .catch(e => {
      warning(tab.id, 'Failed to sendUndoTemporaryWhitelistToContentScript', e);
      if (callback) callback();
    });
};

export const openLinkInSuspendedTab = (parentTab, linkedUrl) => {
  //imitate chromes 'open link in new tab' behaviour in how it selects the correct index
  chrome.tabs.query({ windowId: chrome.windows.WINDOW_ID_CURRENT }, tabs => {
    let newTabIndex = parentTab.index + 1;
    let nextTab = tabs[newTabIndex];
    while (nextTab && nextTab.openerTabId === parentTab.id) {
      newTabIndex++;
      nextTab = tabs[newTabIndex];
    }
    const newTabProperties = {
      url: linkedUrl,
      index: newTabIndex,
      openerTabId: parentTab.id,
      active: false,
    };
    chrome.tabs.create(newTabProperties, tab => {
      queueTabForSuspension(tab, 1);
    });
  });
};

export const toggleSuspendedStateOfHighlightedTab = () => {
  getCurrentlyActiveTab(activeTab => {
    if (activeTab) {
      if (isSuspendedTab(activeTab)) {
        unsuspendTab(activeTab);
      } else {
        queueTabForSuspension(activeTab, 1);
      }
    }
  });
};

export const suspendHighlightedTab = () => {
  getCurrentlyActiveTab(activeTab => {
    if (activeTab) {
      queueTabForSuspension(activeTab, 1);
    }
  });
};

export const unsuspendHighlightedTab = () => {
  getCurrentlyActiveTab(activeTab => {
    if (activeTab && isSuspendedTab(activeTab)) {
      unsuspendTab(activeTab);
    }
  });
};

export const suspendAllTabs = force => {
  const forceLevel = force ? 1 : 2;
  getCurrentlyActiveTab(activeTab => {
    if (!activeTab) {
      warning('background', 'Could not determine currently active window.');
      return;
    }
    chrome.windows.get(activeTab.windowId, { populate: true }, curWindow => {
      for (const tab of curWindow.tabs) {
        if (!tab.active) {
          queueTabForSuspension(tab, forceLevel);
        }
      }
    });
  });
};

export const suspendAllTabsInAllWindows = force => {
  const forceLevel = force ? 1 : 2;
  chrome.tabs.query({}, tabs => {
    for (const tab of tabs) {
      queueTabForSuspension(tab, forceLevel);
    }
  });
};

export const unsuspendAllTabs = () => {
  getCurrentlyActiveTab(function(activeTab) {
    if (!activeTab) {
      warning('background', 'Could not determine currently active window.');
      return;
    }
    chrome.windows.get(activeTab.windowId, { populate: true }, curWindow => {
      for (const tab of curWindow.tabs) {
        unqueueTabForSuspension(tab);
        if (isSuspendedTab(tab)) {
          unsuspendTab(tab);
        } else if (isNormalTab(tab) && !tab.active) {
          resetAutoSuspendTimerForTab(tab);
        }
      }
    });
  });
};

export const unsuspendAllTabsInAllWindows = () => {
  chrome.windows.getLastFocused({}, currentWindow => {
    chrome.tabs.query({}, tabs => {
      // Because of the way that unsuspending steals window focus, we defer the suspending of tabs in the
      // current window until last
      const deferredTabs = [];
      for (const tab of tabs) {
        unqueueTabForSuspension(tab);
        if (isSuspendedTab(tab)) {
          if (tab.windowId === currentWindow.id) {
            deferredTabs.push(tab);
          } else {
            unsuspendTab(tab);
          }
        } else if (isNormalTab(tab)) {
          resetAutoSuspendTimerForTab(tab);
        }
      }
      for (const tab of deferredTabs) {
        unsuspendTab(tab);
      }
    });
  });
};

export const suspendSelectedTabs = () => {
  chrome.tabs.query(
    { highlighted: true, lastFocusedWindow: true },
    selectedTabs => {
      for (const tab of selectedTabs) {
        queueTabForSuspension(tab, 1);
      }
    }
  );
};

export const unsuspendSelectedTabs = () => {
  chrome.tabs.query(
    { highlighted: true, lastFocusedWindow: true },
    selectedTabs => {
      for (const tab of selectedTabs) {
        unqueueTabForSuspension(tab);
        if (isSuspendedTab(tab)) {
          unsuspendTab(tab);
        }
      }
    }
  );
};

export const queueSessionTimer = () => {
  clearTimeout(_sessionSaveTimer);
  _sessionSaveTimer = setTimeout(function() {
    log('background', 'updating current session');
    updateCurrentSession(); //async
  }, 1000);
};

export const resetAutoSuspendTimerForTab = tab => {
  clearAutoSuspendTimerForTabId(tab.id);

  const suspendTime = getOption(SUSPEND_TIME);
  const timeToSuspend = suspendTime * (1000 * 60);
  if (isProtectedActiveTab(tab) || isNaN(suspendTime) || suspendTime <= 0) {
    return;
  }

  const timerDetails = {};
  timerDetails.tabId = tab.id;
  timerDetails.suspendDateTime = new Date(new Date().getTime() + timeToSuspend);

  timerDetails.timer = setTimeout(async () => {
    const updatedTabId = timerDetails.tabId; // This may get updated via updateTabIdReferences
    const updatedTab = await tabsGet(updatedTabId);
    if (!updatedTab) {
      warning(updatedTabId, 'Couldnt find tab. Aborting suspension');
      return;
    }
    queueTabForSuspension(updatedTab, 3);
  }, timeToSuspend);
  log(tab.id, 'Adding tab timer for: ' + timerDetails.suspendDateTime);

  setTabStatePropForTabId(tab.id, STATE_TIMER_DETAILS, timerDetails);
};

export const resetAutoSuspendTimerForAllTabs = () => {
  chrome.tabs.query({}, tabs => {
    for (const tab of tabs) {
      if (isNormalTab(tab)) {
        resetAutoSuspendTimerForTab(tab);
      }
    }
  });
};

export const unsuspendTab = tab => {
  if (!isSuspendedTab(tab)) return;

  const originalUrl = getOriginalUrlFromSuspendedUrl(tab.url);

  if (originalUrl) {
    // NOTE: Temporarily disable autoDiscardable, as there seems to be a bug
    // where discarded (and frozen?) suspended tabs will not unsuspend with
    // chrome.tabs.update if this is set to true. This should remain set to true.
    log(tab.id, 'Unsuspending tab via chrome.tabs.update');
    chrome.tabs.update(tab.id, { url: originalUrl, autoDiscardable: false });
    return;
  }

  log(tab.id, 'Failed to execute unsuspend tab.');
};

export const checkForTriggerUrls = (tab, url) => {
  // test for special case of a successful donation
  if (url.indexOf('greatsuspender.github.io/thanks.html') > 0) {
    setOptionAndSync(NO_NAG, true);
    reportEvent('Donations', 'HidePopupAuto', true);
    chrome.tabs.update(tab.id, {
      url: chrome.runtime.getURL('thanks.html'),
    });

    // test for a save of keyboard shortcuts (chrome://extensions/shortcuts)
  } else if (url === 'chrome://extensions/shortcuts') {
    _triggerHotkeyUpdate = true;
  }
};

export const handleUnsuspendedTabStateChanged = (tab, changeInfo) => {
  if (
    !hasProperty(changeInfo, 'status') &&
    !hasProperty(changeInfo, 'audible') &&
    !hasProperty(changeInfo, 'pinned') &&
    !hasProperty(changeInfo, 'discarded')
  ) {
    return;
  }
  log(tab.id, 'unsuspended tab state changed. changeInfo: ', changeInfo);

  // Check if tab has just been discarded
  if (hasProperty(changeInfo, 'discarded') && changeInfo.discarded) {
    log(tab.id, 'Unsuspended tab has been discarded. Url: ' + tab.url);
    //TODO: Remove this code?
    // handleDiscardedUnsuspendedTab(tab); //async. unhandled promise.

    // When a tab is discarded the tab id changes. We need up-to-date UNSUSPENDED
    // tabIds in the current session otherwise crash recovery will not work
    queueSessionTimer();
    return;
  }

  let hasTabStatusChanged = false;

  // Check for change in tabs audible status
  if (hasProperty(changeInfo, 'audible')) {
    //reset tab timer if tab has just finished playing audio
    if (!changeInfo.audible && getOption(IGNORE_AUDIO)) {
      resetAutoSuspendTimerForTab(tab);
    }
    hasTabStatusChanged = true;
  }
  if (hasProperty(changeInfo, 'pinned')) {
    //reset tab timer if tab has become unpinned
    if (!changeInfo.pinned && getOption(IGNORE_PINNED)) {
      resetAutoSuspendTimerForTab(tab);
    }
    hasTabStatusChanged = true;
  }

  if (hasProperty(changeInfo, 'status')) {
    if (changeInfo.status === 'loading') {
      if (getStatusForTabId(tab.id) === 'suspended') {
        setStatusForTabId(tab.id, 'unsuspending');
      }
    } else if (changeInfo.status === 'complete') {
      const tempWhitelistOnReload = getTabStatePropForTabId(
        tab.id,
        STATE_TEMP_WHITELIST_ON_RELOAD
      );
      const scrollPos = getScrollPosForTabId(tab.id);
      const tabStatus = getStatusForTabId(tab.id);
      if (tabStatus === 'unsuspending') {
        removeTabHistoryForUnuspendedTab(tab.url);
      }
      setStatusForTabId(tab.id, 'unsuspended');
      clearTabStateForTabId(tab.id);

      // if (setAutodiscardable) {
      //   tabsUpdate(tab.id, { autoDiscardable: true });
      // }

      //init loaded tab
      resetAutoSuspendTimerForTab(tab);
      initialiseTabContentScript(tab, tempWhitelistOnReload, scrollPos)
        .catch(() => {
          warning(
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
  if (hasTabStatusChanged && isCurrentFocusedTab(tab)) {
    calculateTabStatus(tab, null, function(status) {
      setIconStatus(status, tab.id);
    });
  }
};

export const removeTabHistoryForUnuspendedTab = url => {
  // chrome.history.deleteUrl({ url: suspendedUrl });
  chrome.history.getVisits({ url }, visits => {
    console.log('visits for: ' + url, visits);
    //assume history entry will be the second to latest one (latest one is the currently visible page)
    //NOTE: this will break if the same url has been visited by another tab more recently than the
    //suspended tab (pre suspension)
    // eslint-disable-next-line no-unused-vars, @typescript-eslint/no-unused-vars
    const latestVisit = visits.pop();
    const previousVisit = visits.pop();
    if (previousVisit) {
      chrome.history.deleteRange(
        {
          startTime: previousVisit.visitTime - 0.1,
          endTime: previousVisit.visitTime + 0.1,
        },
        () => {
          //noop
        }
      );
    }
  });
};

export const handleSuspendedTabStateChanged = (tab, changeInfo) => {
  if (
    !hasProperty(changeInfo, 'status') &&
    !hasProperty(changeInfo, 'discarded')
  ) {
    return;
  }

  log(tab.id, 'suspended tab status changed. changeInfo: ', changeInfo);
  const currentTabStatus = getStatusForTabId(tab.id);
  log(tab.id, 'currentTabStatus: ', currentTabStatus);

  if (changeInfo.status && changeInfo.status === 'loading') {
    if (currentTabStatus === 'suspended') {
      // Assume suspended tab has been refreshed, in which case we want to unsuspend tab
      //TODO: Fix this
      // log(tab.id, 'unsuspending tab due to page refresh.');
      // unsuspendTab(tab);
    }
    setStatusForTabId(tab.id, 'suspending');
    return;
  }

  if (
    (changeInfo.status && changeInfo.status === 'complete') ||
    changeInfo.discarded
  ) {
    setStatusForTabId(tab.id, 'suspended');
    if (isCurrentFocusedTab(tab)) {
      setIconStatus(STATUS_SUSPENDED, tab.id);
    }
  }
};

export const updateTabIdReferences = (newTabId, oldTabId) => {
  log(oldTabId, 'update tabId references to ' + newTabId);
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
  updateTabStateIdReferences(newTabId, oldTabId);
  const timerDetails = getTabStatePropForTabId(newTabId, STATE_TIMER_DETAILS);
  if (timerDetails) {
    timerDetails.tabId = newTabId;
  }
};

export const removeTabIdReferences = tabId => {
  log(tabId, 'removing tabId references to ' + tabId);
  for (const windowId of Object.keys(_currentFocusedTabIdByWindowId)) {
    if (_currentFocusedTabIdByWindowId[windowId] === tabId) {
      _currentFocusedTabIdByWindowId[windowId] = null;
    }
  }
  for (const windowId of Object.keys(_currentStationaryTabIdByWindowId)) {
    if (_currentStationaryTabIdByWindowId[windowId] === tabId) {
      _currentStationaryTabIdByWindowId[windowId] = null;
    }
  }
  clearTabStateForTabId(tabId);
};

export const handleWindowFocusChanged = windowId => {
  log(windowId, 'window gained focus');
  if (windowId < 0 || windowId === _currentFocusedWindowId) {
    return;
  }
  _currentFocusedWindowId = windowId;

  // Get the active tab in the newly focused window
  chrome.tabs.query({ active: true }, function(tabs) {
    if (!tabs || !tabs.length) {
      return;
    }
    let focusedTab;
    for (const tab of tabs) {
      if (tab.windowId === windowId) {
        focusedTab = tab;
      }
    }
    if (!focusedTab) {
      warning(
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
};

export const handleTabFocusChanged = async (tabId, windowId) => {
  log(tabId, 'tab gained focus');

  const focusedTab = await tabsGet(tabId);
  if (!focusedTab) {
    // If focusedTab is null then assume tab has been discarded between the
    // time the chrome.tabs.onActivated event was activated and now.
    // If so, then a subsequeunt chrome.tabs.onActivated event will be called
    // with the new discarded id
    log(
      tabId,
      'Could not find newly focused tab. Assuming it has been discarded'
    );
    return;
  }

  const previouslyFocusedTabId = _currentFocusedTabIdByWindowId[windowId];
  _currentFocusedTabIdByWindowId[windowId] = tabId;

  // If the tab focused before this was the keyboard shortcuts page, then update hotkeys on suspended pages
  if (_triggerHotkeyUpdate) {
    await buildSuspensionToggleHotkey();
    await buildSettingsStateHash();
    _triggerHotkeyUpdate = false;
  }

  let contentScriptStatus = null;
  if (isNormalTab(focusedTab, true)) {
    // If normal tab, then ensure it has a responsive content script
    contentScriptStatus = await getContentScriptStatus(focusedTab.id);
    if (!contentScriptStatus) {
      await reinjectContentScriptOnTab(focusedTab);
      contentScriptStatus = await getContentScriptStatus(focusedTab.id);
    }
    log(focusedTab.id, 'Content script status: ' + contentScriptStatus);
  } else if (isSuspendedTab(focusedTab)) {
    // If suspended tab, then display full suspension UI
    const settingsStateHash = getSettingsStateHash();
    const tabStateHash = getSettingsHashFromSuspendedUrl(focusedTab.url);
    if (settingsStateHash !== tabStateHash) {
      //TODO: Reinstate this code
      // reinitialiseSuspendedTab(focusedTab);
    }
  }

  //update icon
  const status = await new Promise(r => {
    calculateTabStatus(focusedTab, contentScriptStatus, r);
  });
  log(focusedTab.id, 'Focused tab status: ' + status);

  //if this tab still has focus then update icon
  if (_currentFocusedTabIdByWindowId[windowId] === focusedTab.id) {
    setIconStatus(status, focusedTab.id);
  }

  //pause for a bit before assuming we're on a new tab as some users
  //will key through intermediate tabs to get to the one they want.
  queueNewTabFocusTimer(tabId, windowId, focusedTab);

  //test for a save of keyboard shortcuts (chrome://extensions/shortcuts)
  if (focusedTab.url === 'chrome://extensions/shortcuts') {
    _triggerHotkeyUpdate = true;
  }
};

export const queueNewWindowFocusTimer = (tabId, windowId, focusedTab) => {
  clearTimeout(_newWindowFocusTimer);
  _newWindowFocusTimer = setTimeout(function() {
    const previousStationaryWindowId = _currentStationaryWindowId;
    _currentStationaryWindowId = windowId;
    const previousStationaryTabId =
      _currentStationaryTabIdByWindowId[previousStationaryWindowId];
    handleNewStationaryTabFocus(tabId, previousStationaryTabId, focusedTab);
  }, focusDelay);
};

export const queueNewTabFocusTimer = (tabId, windowId, focusedTab) => {
  clearTimeout(_newTabFocusTimer);
  _newTabFocusTimer = setTimeout(function() {
    const previousStationaryTabId = _currentStationaryTabIdByWindowId[windowId];
    _currentStationaryTabIdByWindowId[windowId] = focusedTab.id;
    handleNewStationaryTabFocus(tabId, previousStationaryTabId, focusedTab);
  }, focusDelay);
};

function handleNewStationaryTabFocus(
  focusedTabId,
  previousStationaryTabId,
  focusedTab
) {
  log(focusedTabId, 'new stationary tab focus handled');

  if (isSuspendedTab(focusedTab)) {
    handleSuspendedTabFocusGained(focusedTab); //async. unhandled promise.
  } else if (isNormalTab(focusedTab)) {
    const queuedTabDetails = getQueuedTabDetails(focusedTab);
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
        unqueueTabForSuspension(focusedTab);
      }
    }
  } else if (focusedTab.url === chrome.runtime.getURL('options.html')) {
    executeViewGlobal(focusedTab.id, VIEW_FUNC_OPTIONS_REINIT);
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
        isNormalTab(previousStationaryTab) &&
        !isProtectedActiveTab(previousStationaryTab)
      ) {
        resetAutoSuspendTimerForTab(previousStationaryTab);
      }
    });
  }
}

export const handleSuspendedTabFocusGained = focusedTab => {
  if (focusedTab.status !== 'loading') {
    //safety check to ensure suspended tab has been initialised
    //TODO: Reenable this check
    // queueTabCheck(focusedTab, { refetchTab: false }, 0);
  }

  //check for auto-unsuspend
  const autoUnsuspend = getOption(UNSUSPEND_ON_FOCUS);
  if (autoUnsuspend) {
    if (navigator.onLine) {
      unsuspendTab(focusedTab);
    } else {
      // showNoConnectivityMessage(suspendedView);
    }
  }
};

export const promptForFilePermissions = () => {
  getCurrentlyActiveTab(activeTab => {
    chrome.tabs.create({
      url: chrome.runtime.getURL('permissions.html'),
      index: activeTab.index + 1,
    });
  });
};

export const checkForNotices = () => {
  log('background', 'Checking for notices..');
  const xhr = new XMLHttpRequest();
  const lastShownNoticeVersion = fetchNoticeVersion();

  xhr.open('GET', 'https://greatsuspender.github.io/notice.json', true);
  xhr.timeout = 4000;
  xhr.setRequestHeader('Cache-Control', 'no-cache');
  xhr.onreadystatechange = function() {
    if (xhr.readyState === 4 && xhr.responseText) {
      let resp;
      try {
        resp = JSON.parse(xhr.responseText);
      } catch (e) {
        error(
          'background',
          'Failed to parse notice response',
          xhr.responseText
        );
        return;
      }

      if (!resp || !resp.active || !resp.text) {
        log('background', 'No new notice found');
        return;
      }

      //only show notice if it is intended for this extension version
      const noticeTargetExtensionVersion = String(resp.target);
      if (
        noticeTargetExtensionVersion !== chrome.runtime.getManifest().version
      ) {
        log(
          'background',
          `Notice target extension version: ${noticeTargetExtensionVersion} 
                does not match actual extension version: ${
                  chrome.runtime.getManifest().version
                }`
        );
        return;
      }

      //only show notice if it has not already been shown
      const noticeVersion = String(resp.version);
      if (noticeVersion <= lastShownNoticeVersion) {
        log(
          'background',
          `Notice version: ${noticeVersion} is not greater than last shown notice version: ${lastShownNoticeVersion}`
        );
        return;
      }

      //show notice - set global notice field (so that it can be trigger to show later)
      _noticeToDisplay = resp;
      reportEvent('Notice', 'Prep', resp.target + ':' + resp.version);
    }
  };
  xhr.send();
};

export const requestNotice = () => {
  return _noticeToDisplay;
};
export const clearNotice = () => {
  _noticeToDisplay = undefined;
};

export const isCharging = () => {
  return _isCharging;
};

export const getContentScriptStatus = (tabId, knownContentScriptStatus) => {
  return new Promise(function(resolve) {
    if (knownContentScriptStatus) {
      resolve(knownContentScriptStatus);
    } else {
      sendRequestInfoToContentScript(tabId)
        .then(tabInfo => {
          if (tabInfo) {
            resolve(tabInfo.status);
          } else {
            resolve(null);
          }
        })
        .catch(e => {
          warning(tabId, 'Error sending request to content script', e);
          resolve(null);
        });
    }
  });
};

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
export const calculateTabStatus = (tab, knownContentScriptStatus, callback) => {
  //check for loading
  if (tab.status === 'loading') {
    callback(STATUS_LOADING);
    return;
  }
  //check if it is a blockedFile tab (this needs to have precedence over isSpecialTab)
  if (isBlockedFileTab(tab)) {
    callback(STATUS_BLOCKED_FILE);
    return;
  }

  //check if it is a special tab
  if (isSpecialTab(tab)) {
    callback(STATUS_SPECIAL);
    return;
  }
  //check if tab has been discarded
  if (isDiscardedTab(tab)) {
    callback(STATUS_DISCARDED);
    return;
  }
  //check if it has already been suspended
  if (isSuspendedTab(tab)) {
    callback(STATUS_SUSPENDED);
    return;
  }
  //check whitelist
  if (checkWhiteList(tab.url)) {
    callback(STATUS_WHITELISTED);
    return;
  }
  //check never suspend
  //should come after whitelist check as it causes popup to show the whitelisting option
  if (getOption(SUSPEND_TIME) === '0') {
    callback(STATUS_NEVER);
    return;
  }
  getContentScriptStatus(tab.id, knownContentScriptStatus).then(
    contentScriptStatus => {
      if (contentScriptStatus && contentScriptStatus !== STATUS_NORMAL) {
        callback(contentScriptStatus);
        return;
      }
      //check running on battery
      if (getOption(IGNORE_WHEN_CHARGING) && _isCharging) {
        callback(STATUS_CHARGING);
        return;
      }
      //check internet connectivity
      if (getOption(IGNORE_WHEN_OFFLINE) && !navigator.onLine) {
        callback(STATUS_NOCONNECTIVITY);
        return;
      }
      //check pinned tab
      if (isProtectedPinnedTab(tab)) {
        callback(STATUS_PINNED);
        return;
      }
      //check audible tab
      if (isProtectedAudibleTab(tab)) {
        callback(STATUS_AUDIBLE);
        return;
      }
      //check active
      if (isProtectedActiveTab(tab)) {
        callback(STATUS_ACTIVE);
        return;
      }
      if (contentScriptStatus) {
        callback(contentScriptStatus); // should be 'normal'
        return;
      }
      callback(STATUS_UNKNOWN);
    }
  );
};

export const getActiveTabStatus = callback => {
  getCurrentlyActiveTab(function(tab) {
    if (!tab) {
      callback(STATUS_UNKNOWN);
      return;
    }
    calculateTabStatus(tab, null, function(status) {
      callback(status);
    });
  });
};

//change the icon to either active or inactive
export const setIconStatus = (status, tabId) => {
  // log(tabId, 'Setting icon status: ' + status);
  const icon = ![STATUS_NORMAL, STATUS_ACTIVE].includes(status)
    ? ICON_SUSPENSION_PAUSED
    : ICON_SUSPENSION_ACTIVE;
  chrome.browserAction.setIcon({ path: icon, tabId: tabId }, function() {
    if (chrome.runtime.lastError) {
      warning(
        tabId,
        chrome.runtime.lastError,
        `Failed to set icon for tab. Tab may have been closed.`
      );
    }
  });
};

export const setIconStatusForActiveTab = () => {
  getCurrentlyActiveTab(function(tab) {
    if (!tab) {
      return;
    }
    calculateTabStatus(tab, null, function(status) {
      setIconStatus(status, tab.id);
    });
  });
};

//HANDLERS FOR RIGHT-CLICK CONTEXT MENU
export const buildContextMenu = showContextMenu => {
  const allContexts = ['page', 'frame', 'editable', 'image', 'video', 'audio']; //'selection',

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

    chrome.contextMenus.create({
      title: chrome.i18n.getMessage('js_context_toggle_suspend_state'),
      contexts: allContexts,
      onclick: () => toggleSuspendedStateOfHighlightedTab(),
    });
    chrome.contextMenus.create({
      title: chrome.i18n.getMessage('js_context_toggle_pause_suspension'),
      contexts: allContexts,
      onclick: () => requestToggleTempWhitelistStateOfHighlightedTab(),
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
      type: 'separator',
      contexts: allContexts,
    });
    chrome.contextMenus.create({
      title: chrome.i18n.getMessage('js_context_suspend_selected_tabs'),
      contexts: allContexts,
      onclick: () => suspendSelectedTabs(),
    });
    chrome.contextMenus.create({
      title: chrome.i18n.getMessage('js_context_unsuspend_selected_tabs'),
      contexts: allContexts,
      onclick: () => unsuspendSelectedTabs(),
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
      title: chrome.i18n.getMessage('js_context_unsuspend_all_tabs_in_window'),
      contexts: allContexts,
      onclick: () => unsuspendAllTabs(),
    });

    chrome.contextMenus.create({
      type: 'separator',
      contexts: allContexts,
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
      onclick: () => unsuspendAllTabsInAllWindows(),
    });
  }
};

//HANDLERS FOR KEYBOARD SHORTCUTS

export const addCommandListeners = () => {
  chrome.commands.onCommand.addListener(function(command) {
    if (command === '1-suspend-tab') {
      toggleSuspendedStateOfHighlightedTab();
    } else if (command === '2-toggle-temp-whitelist-tab') {
      requestToggleTempWhitelistStateOfHighlightedTab();
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
};

//HANDLERS FOR MESSAGE REQUESTS

export const messageRequestListener = (request, sender, sendResponse) => {
  log(sender.tab.id, 'background messageRequestListener', request.action);

  if (request.action === 'reportTabState') {
    const contentScriptStatus =
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
    sendResponse();
    return false;
  }

  if (request.action === 'savePreviewData') {
    handlePreviewImageResponse(
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
};

export const externalMessageRequestListener = (
  request,
  sender,
  sendResponse
) => {
  log('background', 'external message request: ', request, sender);

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
      tab = await tabsGet(request.tabId);
      if (!tab) {
        sendResponse('Error: no tab found with id: ' + request.tabId);
        return;
      }
    } else {
      tab = await new Promise(r => {
        getCurrentlyActiveTab(r);
      });
    }
    if (!tab) {
      sendResponse('Error: failed to find a target tab');
      return;
    }

    if (request.action === 'suspend') {
      if (isSuspendedTab(tab)) {
        sendResponse('Error: tab is already suspended');
        return;
      }

      queueTabForSuspension(tab, 1);
      sendResponse();
      return;
    }

    if (request.action === 'unsuspend') {
      if (!isSuspendedTab(tab)) {
        sendResponse('Error: tab is not suspended');
        return;
      }

      unsuspendTab(tab);
      sendResponse();
      return;
    }
  })();
  return true;
};

export const addMessageListeners = () => {
  chrome.runtime.onMessage.addListener(messageRequestListener);
  //attach listener to runtime for external messages, to allow
  //interoperability with other extensions in the manner of an API
  chrome.runtime.onMessageExternal.addListener(externalMessageRequestListener);
};

export const addChromeListeners = () => {
  // const extensionUrl = chrome.runtime.getURL('');
  // const host = new URL(extensionUrl).host;

  chrome.webRequest.onBeforeRequest.addListener(
    function(details) {
      console.log('details', details);
      if (details.url.indexOf(SUSPEND_URL_PREFIX) > 0) {
        const suspendedProps = parseEncodedQueryString(
          details.url.split(SUSPEND_URL_PREFIX)[1],
          true
        );
        const faviconMeta = getFaviconMetaForTabId(details.tabId);
        const dataUrl = generateIframeContainerDataUrl(
          suspendedProps,
          faviconMeta
        );
        // Suspend tab by redirecting to the data:text/html url
        return { redirectUrl: dataUrl };
      }
      if (details.url.indexOf(SUSPENDED_IFRAME_PREFIX) > 0) {
        const suspendedProps = parseEncodedQueryString(
          details.url.split(SUSPENDED_IFRAME_PREFIX)[1],
          true
        );
        const curSettingsHash = getSettingsStateHash();
        const tabSettingsHash = getSettingsHashForTabId(details.tabId);
        const faviconMeta = getFaviconMetaForTabId(details.tabId);
        const suspendedHtml = generateIframeContentsDataUrl(
          suspendedProps,
          faviconMeta
        );
        if (tabSettingsHash === curSettingsHash) {
          console.log('cancel');
          return { cancel: true };
        } else {
          setSettingsHashForTabId(details.tabId, curSettingsHash);
          console.log('init');
          return { redirectUrl: suspendedHtml };
        }
      }
      if (details.url.indexOf(KEYBOARD_SHORTCUTS_PREFIX) > 0) {
        return {
          redirectUrl: browser.extension.getURL('shortcuts.html'),
        };
      }

      return { cancel: false };
    },

    // { urls: [`*://${host}/${SUSPEND_URL_PREFIX}*`] },
    // { urls: [`${chrome.runtime.getURL('')}/${SUSPEND_URL_PREFIX}*`] },
    {
      urls: [`${INTERNAL_MSG_URL}*`],
    },
    ['blocking']
  );

  chrome.windows.onFocusChanged.addListener(function(windowId) {
    handleWindowFocusChanged(windowId);
  });
  chrome.tabs.onActivated.addListener(function(activeInfo) {
    handleTabFocusChanged(activeInfo.tabId, activeInfo.windowId); // async. unhandled promise
  });
  chrome.tabs.onReplaced.addListener(function(addedTabId, removedTabId) {
    updateTabIdReferences(addedTabId, removedTabId);
  });
  chrome.tabs.onCreated.addListener(function(tab) {
    log(tab.id, 'tab created. tabUrl: ' + tab.url);
    queueSessionTimer();

    // It's unusual for a suspended tab to be created. Usually they are updated
    // from a normal tab. This usually happens when using 'reopen closed tab'.
    if (isSuspendedTab(tab) && !tab.active) {
      // Queue tab for check but mark it as sleeping for 5 seconds to give
      // a chance for the tab to load
      //TODO: Reenable this check
      // queueTabCheck(tab, {}, 5000);
    }
  });
  chrome.tabs.onRemoved.addListener(function(tabId) {
    log(tabId, 'tab removed.');
    queueSessionTimer();
    removeTabIdReferences(tabId);
  });
  chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
    if (!changeInfo) return;

    // if url has changed
    if (changeInfo.url) {
      log(tabId, 'tab url changed. changeInfo: ', changeInfo);

      checkForTriggerUrls(tab, changeInfo.url);
      queueSessionTimer();
    }

    if (isSuspendedTab(tab)) {
      handleSuspendedTabStateChanged(tab, changeInfo);
    } else if (isNormalTab(tab)) {
      handleUnsuspendedTabStateChanged(tab, changeInfo);
    }
  });
  chrome.windows.onCreated.addListener(function(window) {
    log(window.id, 'window created.');
    queueSessionTimer();

    // eslint-disable-next-line no-var
    const noticeToDisplay = requestNotice();
    if (noticeToDisplay) {
      chrome.tabs.create({ url: chrome.runtime.getURL('notice.html') });
      reportEvent(
        'Notice',
        'Display',
        noticeToDisplay.target + ':' + noticeToDisplay.version
      );
    }
  });
  chrome.windows.onRemoved.addListener(function(windowId) {
    log(windowId, 'window removed.');
    queueSessionTimer();
  });
};

export const addMiscListeners = () => {
  //add listener for battery state changes
  if (navigator.getBattery) {
    navigator.getBattery().then(function(battery) {
      _isCharging = battery.charging;

      battery.onchargingchange = function() {
        _isCharging = battery.charging;
        log('background', `_isCharging: ${_isCharging}`);
        setIconStatusForActiveTab();
        //restart timer on all normal tabs
        //NOTE: some tabs may have been prevented from suspending when computer was charging
        if (!_isCharging && getOption(IGNORE_WHEN_CHARGING)) {
          resetAutoSuspendTimerForAllTabs();
        }
      };
    });
  }

  //add listeners for online/offline state changes
  window.addEventListener('online', function() {
    log('background', 'Internet is online.');
    //restart timer on all normal tabs
    //NOTE: some tabs may have been prevented from suspending when internet was offline
    if (getOption(IGNORE_WHEN_OFFLINE)) {
      resetAutoSuspendTimerForAllTabs();
    }
    setIconStatusForActiveTab();
  });
  window.addEventListener('offline', function() {
    log('background', 'Internet is offline.');
    setIconStatusForActiveTab();
  });
};
