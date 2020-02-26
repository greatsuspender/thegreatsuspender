import { Tabs, browser } from 'webextension-polyfill-ts';

import { ContentScript } from '../contentscript';
import {
  log,
  warning,
  error,
  isSpecialTab,
  isSuspendedTab,
  isDiscardedTab,
} from '../gsUtils';

import { getOption, IGNORE_FORMS } from '../gsStorage';

type RequestInfoPayload = {
  action: 'requestInfo';
};

type InitialisePayload = {
  action: 'initialise';
  ignoreForms?: boolean;
  tempWhitelist?: boolean;
  scrollPos?: number;
};

export const sendMessageToContentScript = async (
  tabId: number,
  message: any
): Promise<any> => {
  return browser.tabs.sendMessage(tabId, message);
};

export const sendUpdateToContentScriptOfTab = async (
  tab: Tabs.Tab
): Promise<any> => {
  if (
    !tab.id ||
    isSpecialTab(tab) ||
    isSuspendedTab(tab) ||
    isDiscardedTab(tab)
  ) {
    return;
  }

  const ignoreForms = getOption(IGNORE_FORMS);
  return sendMessageToContentScript(tab.id, { ignoreForms });
};

export const sendTemporaryWhitelistToContentScript = async (
  tabId: number
): Promise<any> => {
  return sendMessageToContentScript(tabId, {
    tempWhitelist: true,
  });
};

export const sendUndoTemporaryWhitelistToContentScript = (
  tabId: number
): Promise<any> => {
  return sendMessageToContentScript(tabId, {
    tempWhitelist: false,
  });
};

export const sendRequestInfoToContentScript = (tabId: number): Promise<any> => {
  return sendMessageToContentScript(tabId, {
    action: 'requestInfo',
  });
};

export const initialiseTabContentScript = async (
  tab: Tabs.Tab,
  isTempWhitelist: boolean,
  scrollPos?: number
): Promise<void> => {
  if (!tab.id) return;
  const ignoreForms = getOption(IGNORE_FORMS);
  const payload: InitialisePayload = {
    action: 'initialise',
    ignoreForms: ignoreForms,
    tempWhitelist: isTempWhitelist,
  };
  if (scrollPos) {
    payload.scrollPos = scrollPos;
  }
  return sendMessageToContentScript(tab.id, payload);
};

// Careful with this function. It seems that these unresponsive tabs can sometimes
// not return any result after chrome.tabs.executeScript
// Try to mitigate this by wrapping in a setTimeout
// TODO: Report chrome bug
// Unrelated, but reinjecting content scripts has some issues:
// https://groups.google.com/a/chromium.org/forum/#!topic/chromium-extensions/QLC4gNlYjbA
// https://bugs.chromium.org/p/chromium/issues/detail?id=649947
// Notably (for me), the key listener of the old content script remains active
// if using: window.addEventListener('keydown', formInputListener);
export const reinjectContentScriptOnTab = (tab: Tabs.Tab): Promise<void> => {
  return new Promise(resolve => {
    log(
      tab.id,
      'contentScripts',
      'Reinjecting contentscript into unresponsive unsuspended tab.',
      tab
    );
    const executeScriptTimeout = setTimeout(() => {
      log(
        'contentScripts',
        tab.id,
        'chrome.tabs.executeScript failed to trigger callback'
      );
      resolve();
    }, 10000);

    browser.tabs
      .executeScript(tab.id, {
        code: `(${ContentScript})();`,
      })
      .then(() => {
        clearTimeout(executeScriptTimeout);
        initialiseTabContentScript(tab, false)
          .then(tabInfo => {
            resolve(tabInfo);
          })
          .catch(() => {
            resolve();
          });
      })
      .catch(e => {
        warning(tab.id, 'Failed to execute js/contentscript.js on tab', e);
        resolve();
        return;
      });
  });
};
