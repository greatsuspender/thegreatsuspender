import { Tabs, browser } from 'webextension-polyfill-ts';

import {
  log,
  error,
  isSuspendedTab,
  getScrollPositionFromSuspendedUrl,
} from '../gsUtils';

import { FALLBACK_CHROME_FAVICON_META, getFaviconMetaData } from '../gsFavicon';
import { FaviconMeta } from '../actions/suspendTab';

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
  settingsHash?: string;
  scrollPos?: number;
  faviconMeta?: FaviconMeta;
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
      let faviconMeta;
      if (isSuspended) {
        const suspendedScrollPos = getScrollPositionFromSuspendedUrl(tab.url);
        scrollPos = parseInt(suspendedScrollPos) || 0;
        faviconMeta = await getFaviconMetaData(tab);
      }
      tabStateByTabId[tab.id] = {
        status,
        scrollPos,
        faviconMeta,
      };
    }
  } catch (e) {
    error(e);
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

export const setFaviconMetaForTabId = (
  tabId: number,
  faviconMeta: FaviconMeta
): void => {
  const tabState = findOrCreateTabState(tabId);
  tabState.faviconMeta = faviconMeta;
};

export const getFaviconMetaForTabId = (tabId: number): FaviconMeta => {
  const tabState = tabStateByTabId[tabId];
  if (!tabState) {
    log('gsTabStates', `Could not find tab for id: ${tabId}`);
    return FALLBACK_CHROME_FAVICON_META;
  }
  return tabState.faviconMeta || FALLBACK_CHROME_FAVICON_META;
};

export const setSettingsHashForTabId = (
  tabId: number,
  settingsHash: string
): void => {
  const tabState = findOrCreateTabState(tabId);
  tabState.settingsHash = settingsHash;
};

export const getSettingsHashForTabId = (tabId: number): string => {
  const tabState = tabStateByTabId[tabId];
  if (!tabState) {
    log('gsTabStates', `Could not find tab for id: ${tabId}`);
    return '';
  }
  return tabState.settingsHash || '';
};
