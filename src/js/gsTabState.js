import { log } from './gsUtils';

const _tabStateByTabId = {};

// Unsuspended tab props
export const STATE_TIMER_DETAILS = 'timerDetails';

// Suspended tab props
export const STATE_TEMP_WHITELIST_ON_RELOAD = 'whitelistOnReload';
export const STATE_DISABLE_UNSUSPEND_ON_RELOAD = 'disableUnsuspendOnReload';
export const STATE_INITIALISE_SUSPENDED_TAB = 'initialiseSuspendedTab';
export const STATE_UNLOADED_URL = 'unloadedUrl';
export const STATE_HISTORY_URL_TO_REMOVE = 'historyUrlToRemove';
export const STATE_SET_AUTODISCARDABLE = 'setAutodiscardable';
export const STATE_SHOW_NAG = 'showNag';
export const STATE_SUSPEND_REASON = 'suspendReason'; // 1=auto-suspend, 2=manual-suspend, 3=discarded
export const STATE_SCROLL_POS = 'scrollPos';

export function getTabStatePropForTabId(tabId, prop) {
  return _tabStateByTabId[tabId] ? _tabStateByTabId[tabId][prop] : undefined;
}

export function setTabStatePropForTabId(tabId, prop, value) {
  // log(tabId, `Setting tab state prop: ${prop}:`, value);
  const tabState = _tabStateByTabId[tabId] || {};
  tabState[prop] = value;
  _tabStateByTabId[tabId] = tabState;
}

export function clearAutoSuspendTimerForTabId(tabId) {
  const timerDetails = getTabStatePropForTabId(tabId, STATE_TIMER_DETAILS);
  if (!timerDetails) {
    return;
  }
  log(tabId, 'Removing tab timer.');
  clearTimeout(timerDetails.timer);
  setTabStatePropForTabId(tabId, STATE_TIMER_DETAILS, null);
}

export function clearTabStateForTabId(tabId) {
  log(tabId, 'Clearing tab state props:', _tabStateByTabId[tabId]);
  clearAutoSuspendTimerForTabId(tabId);
  delete _tabStateByTabId[tabId];
}

export function updateTabStateIdReferences(newTabId, oldTabId) {
  if (_tabStateByTabId[oldTabId]) {
    _tabStateByTabId[newTabId] = _tabStateByTabId[oldTabId];
    delete _tabStateByTabId[oldTabId];
  }
}
