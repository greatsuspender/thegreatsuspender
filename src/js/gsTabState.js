/* global gsChrome, gsUtils, gsTabSelector, gsTabCheckManager, gsTabDiscardManager, gsTabSuspendManager */
// eslint-disable-next-line no-unused-vars
var gsTabState = (function() {
  'use strict';

  const SHOW_NAG = 'showNag';

  const TIMER_DETAILS = 'timerDetails';

  const CURRENT_STATE = 'currentState';
  const STATE_INITIALISING = 'initialising';
  const STATE_SUSPENDING = 'suspending';
  const STATE_SUSPENDED = 'suspended';
  const STATE_UNSUSPENDING = 'unsuspending';
  const STATE_UNSUSPENDED = 'unsuspended';
  const STATE_UNKNOWN = 'unkonwn';

  const TEMP_WHITELIST_ON_RELOAD = 'whitelistOnReload';
  const UNLOADED_URL = 'unloadedUrl';
  const SCROLL_POS = 'scrollPos';
  const HISTORY_URL_TO_REMOVE = 'historyUrlToRemove';
  const IS_AUTODISCARDABLE = 'isAutodiscardable';

  const _tabStateByTabId = {};

  const TabStatePrototype = {
    tab: null,
    timer: null,
    queue: null,
    requestResuspend: false,
    refetchTab: false,

    [TIMER_DETAILS]: null,
    [TEMP_WHITELIST_ON_RELOAD]: null,
    [UNLOADED_URL]: null,
    [HISTORY_URL_TO_REMOVE]: null,
    [IS_AUTODISCARDABLE]: null,
    [SHOW_NAG]: null,
    [SCROLL_POS]: null,

    [CURRENT_STATE]: null,
  };

  const createNewTabState = tab => {
    const tabState = JSON.parse(JSON.stringify(TabStatePrototype));
    tabState.tab = tab;
    tabState.queue = {};
    tabState[CURRENT_STATE] = STATE_INITIALISING;
    _tabStateByTabId[tab.id] = tabState;
    return tabState;
  };

  const findOrCreateTabStateForTab = tab => {
    if (!_tabStateByTabId[tab.id]) {
      gsUtils.error(
        tab.id,
        `TabState does not exist for tabId: ${tab.id}. Will create a new one.`
      );
      _tabStateByTabId[tab.id] = gsTabState.createNewTabState(tab);
    }
    return _tabStateByTabId[tab.id];
  };

  const getTabStateForTabId = tabId => {
    return _tabStateByTabId[tabId];
  };

  const getCurrentActionForTabId = (tabId) => {
    return getPropForTabId[CURRENT_STATE];
  }

  function updateTabIdReferences(newTabId, oldTabId) {
    gsUtils.log(oldTabId, 'update tabId references to ' + newTabId);

    gsTabSelector.updateTabIdReferences(newTabId, oldTabId);
    if (_tabStateByTabId[oldTabId]) {
      _tabStateByTabId[newTabId] = _tabStateByTabId[oldTabId];
      delete _tabStateByTabId[oldTabId];
    }
    if (_tabStateByTabId[newTabId].tab) {
      _tabStateByTabId[newTabId].tab.id = newTabId;
    }
    const timerDetails = getPropForTabId(newTabId, TIMER_DETAILS);
    if (timerDetails) {
      timerDetails.tabId = newTabId;
    }
  }

  async function removeTabIdReferences(tabId) {
    gsUtils.log(tabId, 'removing tabId references to ' + tabId);

    gsTabSelector.removeTabIdReferences(tabId);
    await gsTabCheckManager.removeTabIdReferences(tabId);
    await gsTabDiscardManager.removeTabIdReferences(tabId);
    await gsTabSuspendManager.removeTabIdReferences(tabId);
    delete _tabStateByTabId[tabId];
  }

  const getTabTimer = (tabId) => {
    return getPropForTabId(tabId, TIMER_DETAILS);
  }
  const setTabTimer = (tabId, timerDetails) => {
    setPropForTabId(tabId, TIMER_DETAILS, timerDetails);
  }


  const isTabInitialising = (tabId) => {
    return getPropForTabId(tabId, CURRENT_STATE) === STATE_INITIALISING;
  }
  const setTabInitialising = (tabId) => {
    setPropForTabId(tabId, CURRENT_STATE, STATE_INITIALISING);
  }

  const isTabSuspending = (tabId) => {
    return getPropForTabId(tabId, CURRENT_STATE) === STATE_SUSPENDING;
  }
  const setTabSuspending = (tabId) => {
    setPropForTabId(tabId, CURRENT_STATE, STATE_SUSPENDING);
  }

  const isTabSuspended = (tabId) => {
    return getPropForTabId(tabId, CURRENT_STATE) === STATE_SUSPENDED;
  }
  const setTabSuspended = (tabId) => {
    setPropForTabId(tabId, CURRENT_STATE, STATE_SUSPENDED);
  }

  const isTabUnsuspending = (tabId) => {
    return getPropForTabId(tabId, CURRENT_STATE) === STATE_UNSUSPENDING;
  }
  const setTabUnsuspending = (tabId, suspendedUrl, scrollPosition, wasAutoDiscardable) => {
    setPropForTabId(tabId, CURRENT_STATE, STATE_UNSUSPENDING);
    setPropForTabId(tabId, HISTORY_URL_TO_REMOVE, suspendedUrl);
    setPropForTabId(tabId, SCROLL_POS, scrollPosition);
    setPropForTabId(tabId, IS_AUTODISCARDABLE, wasAutoDiscardable);
  }
  
  const isTabUnsuspended = (tabId) => {
    return getPropForTabId(tabId, CURRENT_STATE) === STATE_UNSUSPENDED;
  }
  const setTabUnsuspended = (tabId) => {
    setPropForTabId(tabId, CURRENT_STATE, STATE_SUSPENDED);
    setPropForTabId(tabId, TEMP_WHITELIST_ON_RELOAD, null);
    setPropForTabId(tabId, HISTORY_URL_TO_REMOVE, null);
    setPropForTabId(tabId, SCROLL_POS, null);
    setPropForTabId(tabId, IS_AUTODISCARDABLE, null);
  }

  const isTabUnknown = (tabId) => {
    return getPropForTabId(tabId, CURRENT_STATE) === STATE_UNKNOWN;
  }
  const setTabUnknown = (tabId) => {
    setPropForTabId(tabId, CURRENT_STATE, STATE_UNKNOWN);
  }


  const getTabTempWhitelistOnReloadFlag = (tabId) => {
    return getPropForTabId(tabId, TEMP_WHITELIST_ON_RELOAD);
  }
  const getTabUnloadedUrlFlag = (tabId) => {
    return getPropForTabId(tabId, UNLOADED_URL);
  }
    const setTabUnloadedUrlFlag = (tabId, unloadedUrl) => {
    return setPropForTabId(tabId, UNLOADED_URL, unloadedUrl);
  }
  const getTabScrollPosFlag = (tabId) => {
    return getPropForTabId(tabId, SCROLL_POS);
  }
  const setTabScrollPosFlag = (tabId, scrollPos) => {
    return setPropForTabId(tabId, SCROLL_POS, scrollPos);
  }
  const getTabHistoryUrlToRemoveFlag = (tabId) => {
    return getPropForTabId(tabId, HISTORY_URL_TO_REMOVE);
  }
  const getTabIsAutoDiscardableFlag = (tabId) => {
    return getPropForTabId(tabId, IS_AUTODISCARDABLE);
  }
  const getTabShowNagFlag = (tabId) => {
    return getPropForTabId(tabId, SHOW_NAG);
  }
  const setTabShowNagFlag = (tabId, showNag) => {
    return setPropForTabId(tabId, SHOW_NAG, showNag);
  }




  const getPropForTabId = (tabId, prop) => {
    if (typeof tabId !== 'number') {
      gsUtils.error(tabId, `Bad tabId: ${tabId}`);
      return;
    }
    if (!TabStatePrototype.hasOwnProperty(prop)) {
      gsUtils.error(tabId, `Unknown tabState property: ${prop}`);
      return;
    }
    const tabState = _tabStateByTabId[tabId];
    if (!tabState) {
      gsUtils.error(tabId, `No tabState exists for tabId: ${tabId}`);
      return;
    }
    return tabState[prop];
  };

  const setPropForTabId = (tabId, prop, value) => {
    if (!TabStatePrototype.hasOwnProperty(prop)) {
      gsUtils.error(tabId, `Unknown tabState property: ${prop}`);
      return;
    }
    const tabState = _tabStateByTabId[tabId];
    if (!tabState) {
      gsUtils.error(tabId, `No tabState exists for tabId: ${tabId}`);
      return;
    }
    _tabStateByTabId[tabId][prop] = value;
  };


  return {
    createNewTabState,
    findOrCreateTabStateForTab,
    getTabStateForTabId,
    setPropForTabId,
    updateTabIdReferences,
    removeTabIdReferences,

    getCurrentActionForTabId,

    getTabTimer,
    setTabTimer,

    isTabInitialising,
    setTabInitialising,
    isTabSuspending,
    setTabSuspending,
    isTabSuspended,
    setTabSuspended,
    isTabUnsuspending,
    setTabUnsuspending,
    isTabUnsuspended,
    setTabUnsuspended,
    isTabUnknown,
    setTabUnknown,

    getTabTempWhitelistOnReloadFlag,
    getTabUnloadedUrlFlag,
    getTabScrollPosFlag,
    getTabHistoryUrlToRemoveFlag,
    getTabIsAutoDiscardableFlag,
    getTabShowNagFlag,

    setTabUnloadedUrlFlag,
    setTabScrollPosFlag,
    setTabShowNagFlag,
  };
})();
