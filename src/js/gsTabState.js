/* global gsUtils  */
// eslint-disable-next-line no-unused-vars
var gsTabState = (function() {
  'use strict';



  const _tabStateByTabId = {};

  const TabStatePrototype = {
    tabId: null,
    initialising: null,
    queueProps: null,
    requestResuspend: false,
    refetchTab: false,
  };

  const createNewTabState = tab => {
    const tabState = Object.assign({}, TabStatePrototype);
    tabState.tabId = tab.id;
    _tabStateByTabId[tab.id] = tabState;
    return tabState;
  };

  const getTabStateForId = tabId => {
    if (!_tabStateByTabId[tabId]) {
      gsUtils.warning(tabId, `TabState does not exist for tabId: ${tabId}. Will create a new one.`);
      _tabStateByTabId[tabId] = gsTabState.createNewTabState(tabId);
    }
    return _tabStateByTabId[tabId];
  }

  const setPropForTabId = (tabId, prop, value) => {
    if (!TabStatePrototype.hasOwnProperty(prop)) {
      gsUtils.error(tabId, `Unknown tabState property: ${prop}`);
      return;
    }
    getTabStateForId(tabId)[prop] = value;
  }

  const initForQueue = (tabState, newQueueProps) => {
    if (tabState.queueProps && tabState.queueProps.queueId !== newQueueProps.queueId) {
      gsUtils.logWarning(tabState.tabId, 'Tab already in a different queue: ' + tabState.queueProps.queueId);
      return false;
    }
    tabState.queueProps = newQueueProps;
    return true;
  }

  return {
    createNewTabState,
    getTabStateForId,
    setPropForTabId,
    initForQueue,
  };
})();
