/*global gsChrome, gsUtils  */
// eslint-disable-next-line no-unused-vars
var gsTabSelector = (function() {
  'use strict';

  const _currentFocusedTabIdByWindowId = {};
  const _currentStationaryTabIdByWindowId = {};

  let _currentFocusedWindowId;
  let _currentStationaryWindowId;

  function initAsPromised() {
    return new Promise(async resolve => {
      //initialise currentStationary and currentFocused vars
      const activeTabs = await gsChrome.tabsQuery({ active: true });
      const currentWindow = await gsChrome.windowsGetLastFocused();
      for (let activeTab of activeTabs) {
        _currentStationaryTabIdByWindowId[activeTab.windowId] = activeTab.id;
        _currentFocusedTabIdByWindowId[activeTab.windowId] = activeTab.id;
        if (currentWindow && currentWindow.id === activeTab.windowId) {
          _currentStationaryWindowId = activeTab.windowId;
          _currentFocusedWindowId = activeTab.windowId;
        }
      }
      gsUtils.log('gsTabSelector', 'init successful');
      resolve();
    });
  }

  async function getCurrentlySelectedTabs() {
    const activeTab = await getCurrentlyActiveTab();
    if (!activeTab) {
      return null;
    }

    let selectedTabs = await gsChrome.tabsQuery({
      highlighted: true,
      windowId: activeTab.windowId,
    });
    if (selectedTabs.length === 1) {
      selectedTabs = [activeTab];
    } else {
      //ensure active tab is first item in array
      selectedTabs = selectedTabs.filter(o => o.id !== activeTab.id);
      selectedTabs.unshift(activeTab);
    }
    return selectedTabs;
  }

  async function getCurrentlyActiveTab() {
    const currentWindowActiveTabs = await gsChrome.tabsQuery({
      active: true,
      currentWindow: true,
    });
    if (currentWindowActiveTabs.length > 0) {
      return currentWindowActiveTabs[0];
    }

    // Fallback on chrome.windows.getLastFocused
    const lastFocusedWindow = await gsChrome.windowsGetLastFocused();
    if (lastFocusedWindow) {
      const lastFocusedWindowActiveTabs = await gsChrome.tabsQuery({
        active: true,
        windowId: lastFocusedWindow.id,
      });
      if (lastFocusedWindowActiveTabs.length > 0) {
        return lastFocusedWindowActiveTabs[0];
      }
    }

    // Fallback on _currentStationaryWindowId
    if (_currentStationaryWindowId) {
      const currentStationaryWindowActiveTabs = await gsChrome.tabsQuery({
        active: true,
        windowId: _currentStationaryWindowId,
      });
      if (currentStationaryWindowActiveTabs.length > 0) {
        return currentStationaryWindowActiveTabs[0];
      }

      // Fallback on currentStationaryTabId
      const currentStationaryTabId =
        _currentStationaryTabIdByWindowId[_currentStationaryWindowId];
      if (currentStationaryTabId) {
        const currentStationaryTab = await gsChrome.tabsGet(
          currentStationaryTabId
        );
        if (currentStationaryTab !== null) {
          return currentStationaryTab;
        }
      }
    }
    return null;
  }

  // NOTE: Stationary here means has had focus for more than focusDelay ms
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

  function isCurrentActiveTab(tab) {
    const activeTabIdForWindow = _currentFocusedTabIdByWindowId[tab.windowId];
    if (activeTabIdForWindow) {
      return tab.id === activeTabIdForWindow;
    } else {
      // fallback on active flag
      return tab.active;
    }
  }

  function getCurrentlyFocusedWindowId() {
    return _currentFocusedWindowId;
  }
  function setCurrentlyFocusedWindowId(windowId) {
    _currentFocusedWindowId = windowId;
  }

  function getCurrentStationaryWindowId() {
    return _currentStationaryWindowId;
  }
  function setCurrentStationaryWindowId(windowId) {
    _currentStationaryWindowId = windowId;
  }

  function getCurrentlyFocusedTabIdForWindowId(windowId) {
    return _currentFocusedTabIdByWindowId[windowId];
  }

  function setCurrentlyFocusedTabIdForWindowId(windowId, tabId) {
    _currentFocusedTabIdByWindowId[windowId] = tabId;
  }

  function getCurrentStationaryTabIdForWindowId(windowId) {
    return _currentStationaryTabIdByWindowId[windowId];
  }

  function setCurrentStationaryTabIdForWindowId(windowId, tabId) {
    _currentStationaryTabIdByWindowId[windowId] = tabId;
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
  }

  function removeTabIdReferences(tabId) {
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
  }

  return {
    initAsPromised,
    getCurrentlySelectedTabs,
    getCurrentlyActiveTab,
    isCurrentStationaryTab,
    isCurrentFocusedTab,
    isCurrentActiveTab,
    getCurrentlyFocusedWindowId,
    setCurrentlyFocusedWindowId,
    getCurrentStationaryWindowId,
    setCurrentStationaryWindowId,
    getCurrentlyFocusedTabIdForWindowId,
    setCurrentlyFocusedTabIdForWindowId,
    getCurrentStationaryTabIdForWindowId,
    setCurrentStationaryTabIdForWindowId,
    updateTabIdReferences,
    removeTabIdReferences,
  };
})();
