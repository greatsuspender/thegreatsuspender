import { Tabs, browser } from 'webextension-polyfill-ts';

import {
  log,
  warning,
  error,
  isSuspendedTab,
  getSuspendedScrollPosition,
} from '../gsUtils';

export type STATE_UNKNOWN = 'unknown';
export type STATE_UNSUSPENDING = 'unsuspending';
export type STATE_UNSUSPENDED = 'unsuspended';
export type STATE_SUSPENDING = 'suspending';
export type STATE_SUSPENDED = 'suspended';

type TabStatus =
  | STATE_UNKNOWN
  | STATE_UNSUSPENDING
  | STATE_UNSUSPENDED
  | STATE_SUSPENDING
  | STATE_SUSPENDED;

export type TabState = {
  status: TabStatus;
  scrollPos?: number;
};

type TabStateByTabId = {
  [tabId: string]: TabState;
};

const tabStateByTabId: TabStateByTabId = {};

export const logAllTabStates = (): void => {
  log('gsTabStates', 'tabStateByTabId:', tabStateByTabId);
};

export const init = async (): Promise<TabStateByTabId> => {
  try {
    const postRecoverySessionTabs = await browser.tabs.query({});
    log('gsTabStates', 'postRecoverySessionTabs:', postRecoverySessionTabs);
    for (const tab of postRecoverySessionTabs) {
      if (!tab.id) continue;
      const isSuspended = isSuspendedTab(tab);
      let scrollPos = 0;
      const status: TabStatus = 'unknown';
      if (isSuspended) {
        const suspendedScrollPos = getSuspendedScrollPosition(tab.url);
        scrollPos = parseInt(suspendedScrollPos) || 0;
      }
      tabStateByTabId[tab.id] = {
        status,
        scrollPos,
      };
    }
  } catch (e) {
    error(new Error('Failed to init tabStateByTabId'));
  }
  logAllTabStates();
  return tabStateByTabId;
};

const findOrCreateTabState = (tabId: number): TabState => {
  if (!tabStateByTabId[tabId]) {
    tabStateByTabId[tabId] = {
      status: 'unknown',
    };
  }
  return tabStateByTabId[tabId];
};

export const setStatusForTabId = (tabId: number, status: TabStatus): void => {
  const tabState = findOrCreateTabState(tabId);
  tabState.status = status;
};

export const getStatusForTabId = (tabId: string): TabStatus => {
  const tabState: TabState = tabStateByTabId[tabId];
  if (!tabState) {
    log('gsTabStates', `Could not find tab for id: ${tabId}`);
    return 'unknown';
  }
  return tabState.status;
};

export const setScrollPosForTabId = (
  tabId: number,
  scrollPos: number
): void => {
  const tabState = findOrCreateTabState(tabId);
  tabState.scrollPos = scrollPos;
};

export const getScrollPosForTabId = (tabId: number): number => {
  const tabState = tabStateByTabId[tabId];
  if (!tabState) {
    log('gsTabStates', `Could not find tab for id: ${tabId}`);
    return 0;
  }
  return tabState.scrollPos || 0;
};
