/* eslint-disable no-console */
/*global __WEBPACK_DEBUG_INFO__, __WEBPACK_DEBUG_ERROR__ */
'use strict';

import { getTabStatePropForTabId, STATE_TIMER_DETAILS } from './gsTabState';
import {
  getOption,
  setOptionAndSync,
  IGNORE_PINNED,
  IGNORE_AUDIO,
  IGNORE_ACTIVE_TABS,
  WHITELIST,
  THEME,
  SUSPEND_IN_PLACE_OF_DISCARD,
  IGNORE_FORMS,
  SUSPEND_TIME,
  IGNORE_WHEN_OFFLINE,
  IGNORE_WHEN_CHARGING,
  SCREEN_CAPTURE,
  SCREEN_CAPTURE_FORCE,
  ADD_CONTEXT,
} from './gsStorage';
import { sendUpdateToContentScriptOfTab } from './helpers/contentScripts';
import {
  tabsGet,
  tabsQuery,
  tabsCreate,
  windowsGet,
  windowsCreate,
} from './gsChrome';
import {
  DATAURL_PREFIX,
  INTERNAL_MSG_URL,
  SUSPENDED_IFRAME_PREFIX,
} from './actions/suspendTab';
import { initAsPromised as gsTabSuspendManagerInit } from './gsTabSuspendManager';
import { isInitialising, isFileUrlsAccessAllowed } from './gsSession';
import { updateTheme, updatePreviewMode } from './gsSuspendedTab';
import { getFaviconMetaData } from './gsFavicon';
import { getInternalViewByTabId } from './gsViews';
import {
  isCurrentFocusedTab,
  unsuspendTab,
  isCharging,
  resetAutoSuspendTimerForTab,
  buildContextMenu,
} from './gsTgs';
import { buildSettingsStateHash } from './helpers/extensionState';

let debugInfo = __WEBPACK_DEBUG_INFO__;
let debugError = __WEBPACK_DEBUG_ERROR__;

export const STATUS_NORMAL = 'normal';
export const STATUS_LOADING = 'loading';
export const STATUS_SPECIAL = 'special';
export const STATUS_BLOCKED_FILE = 'blockedFile';
export const STATUS_SUSPENDED = 'suspended';
export const STATUS_DISCARDED = 'discarded';
export const STATUS_NEVER = 'never';
export const STATUS_FORMINPUT = 'formInput';
export const STATUS_AUDIBLE = 'audible';
export const STATUS_ACTIVE = 'active';
export const STATUS_TEMPWHITELIST = 'tempWhitelist';
export const STATUS_PINNED = 'pinned';
export const STATUS_WHITELISTED = 'whitelisted';
export const STATUS_CHARGING = 'charging';
export const STATUS_NOCONNECTIVITY = 'noConnectivity';
export const STATUS_UNKNOWN = 'unknown';

export const contains = (array, value) => {
  for (let i = 0; i < array.length; i++) {
    if (array[i] === value) return true;
  }
  return false;
};

export const dir = object => {
  if (debugInfo) {
    console.dir(object);
  }
};
export const log = (id, text, ...args) => {
  if (debugInfo) {
    args = args || [];
    console.log(id, (new Date() + '').split(' ')[4], text, ...args);
  }
};
export const warning = (id, text, ...args) => {
  if (debugError) {
    args = args || [];
    const ignores = ['Error', 'gsUtils', 'gsMessages'];
    const errorLine = getStackTrace()
      .split('\n')
      .filter(o => !ignores.find(p => o.indexOf(p) >= 0))
      .join('\n');
    args.push(`\n${errorLine}`);
    console.log('WARNING:', id, (new Date() + '').split(' ')[4], text, ...args);
  }
};
export const errorIfInitialised = (id, errorObj, ...args) => {
  args = args || [];
  if (isInitialising()) {
    warning(id, errorObj, args);
  } else {
    error(id, errorObj, args);
  }
};
export const error = (id, errorObj, ...args) => {
  if (errorObj === undefined) {
    errorObj = id;
    id = '?';
  }
  //NOTE: errorObj may be just a string :/
  if (debugError) {
    const stackTrace = hasProperty(errorObj, 'stack')
      ? errorObj.stack
      : getStackTrace();
    const errorMessage = hasProperty(errorObj, 'message')
      ? errorObj.message
      : typeof errorObj === 'string'
      ? errorObj
      : JSON.stringify(errorObj, null, 2);
    errorObj = errorObj || {};
    console.log(id, (new Date() + '').split(' ')[4], 'Error:');
    console.error(getPrintableError(errorMessage, stackTrace, ...args));
  } else {
    // const logString = hasProperty(errorObj, 'stack')
    //   ? errorObj.stack
    //   : `${JSON.stringify(errorObj)}\n${getStackTrace()}`;
    // gsAnalytics.reportException(logString, false);
  }
};
// Puts all the error args into a single printable string so that all the info
// is displayed in chrome://extensions error console
export const getPrintableError = (errorMessage, stackTrace, ...args) => {
  let errorString = errorMessage;
  errorString += `\n${args.map(o => JSON.stringify(o, null, 2)).join('\n')}`;
  errorString += `\n${stackTrace}`;
  return errorString;
};
export const getStackTrace = () => {
  const obj = {};
  Error.captureStackTrace(obj, getStackTrace);
  return obj.stack;
};

export const isDebugInfo = () => {
  return debugInfo;
};

export const isDebugError = () => {
  return debugError;
};

export const setDebugInfo = value => {
  debugInfo = value;
};

export const setDebugError = value => {
  debugError = value;
};

export const isDiscardedTab = tab => {
  return tab.discarded;
};

//tests for non-standard web pages. does not check for suspended pages!
export const isSpecialTab = tab => {
  const url = tab.url;

  if (isSuspendedUrl(url, true)) {
    return false;
  }
  // Careful, suspended urls start with "chrome-extension://"
  if (
    url.indexOf('about') === 0 ||
    url.indexOf('chrome') === 0 ||
    // webstore urls no longer seem to crash the extension :D
    // url.indexOf('chrome.google.com/webstore') >= 0 ||
    isBlockedFileTab(tab)
  ) {
    return true;
  }
  return false;
};

export const isFileTab = tab => {
  if (tab.url.indexOf('file') === 0) {
    return true;
  }
  return false;
};

//tests if the page is a file:// page AND the user has not enabled access to
//file URLs in extension settings
export const isBlockedFileTab = tab => {
  if (isFileTab(tab) && !isFileUrlsAccessAllowed()) {
    return true;
  }
  return false;
};

//does not include suspended pages!
export const isInternalTab = tab => {
  const isLocalExtensionPage =
    tab.url.indexOf('chrome-extension://' + chrome.runtime.id) === 0;
  return isLocalExtensionPage && !isSuspendedUrl(tab.url);
};

export const isProtectedPinnedTab = tab => {
  const dontSuspendPinned = getOption(IGNORE_PINNED);
  return dontSuspendPinned && tab.pinned;
};

export const isProtectedAudibleTab = tab => {
  const dontSuspendAudible = getOption(IGNORE_AUDIO);
  return dontSuspendAudible && tab.audible;
};

export const isProtectedActiveTab = tab => {
  const dontSuspendActiveTabs = getOption(IGNORE_ACTIVE_TABS);
  return isCurrentFocusedTab(tab) || (dontSuspendActiveTabs && tab.active);
};

// Note: Normal tabs may be in a discarded state
export const isNormalTab = (tab, excludeDiscarded) => {
  excludeDiscarded = excludeDiscarded || false;
  return (
    !isSpecialTab(tab) &&
    !isSuspendedTab(tab, true) &&
    (!excludeDiscarded || !isDiscardedTab(tab))
  );
};

export const isSuspendedTab = tab => {
  return isSuspendedUrl(tab.url);
};

export const isSuspendedUrl = url => {
  return (
    url.indexOf(DATAURL_PREFIX) === 0 &&
    url.indexOf(`${INTERNAL_MSG_URL}${SUSPENDED_IFRAME_PREFIX}`) > 0
  );
};

export const shouldSuspendDiscardedTabs = () => {
  const suspendInPlaceOfDiscard = getOption(SUSPEND_IN_PLACE_OF_DISCARD);
  return suspendInPlaceOfDiscard;
};

export const removeTabsByUrlAsPromised = url => {
  return new Promise(resolve => {
    tabsQuery({ url }).then(tabs => {
      chrome.tabs.remove(
        tabs.map(o => o.id),
        () => {
          resolve();
        }
      );
    });
  });
};

export const createTabAndWaitForFinishLoading = (url, maxWaitTimeInMs) => {
  return new Promise(async resolve => {
    let tab = await tabsCreate(url);
    maxWaitTimeInMs = maxWaitTimeInMs || 1000;
    const retryUntil = Date.now() + maxWaitTimeInMs;
    let loaded = false;
    while (!loaded && Date.now() < retryUntil) {
      tab = await tabsGet(tab.id);
      loaded = tab.status === 'complete';
      if (!loaded) {
        await setTimeout(200);
      }
    }
    resolve(tab);
  });
};

export const createWindowAndWaitForFinishLoading = (
  createData,
  maxWaitTimeInMs
) => {
  return new Promise(async resolve => {
    let window = await windowsCreate(createData);
    maxWaitTimeInMs = maxWaitTimeInMs || 1000;
    const retryUntil = Date.now() + maxWaitTimeInMs;
    let loaded = false;
    while (!loaded && Date.now() < retryUntil) {
      window = await windowsGet(window.id);
      loaded = window.tabs.length > 0 && window.tabs[0].status === 'complete';
      if (!loaded) {
        await setTimeout(200);
      }
    }
    resolve(window);
  });
};

export const checkWhiteList = url => {
  return checkSpecificWhiteList(url, getOption(WHITELIST));
};

export const checkSpecificWhiteList = (url, whitelistString) => {
  const whitelistItems = whitelistString
    ? whitelistString.split(/[\s\n]+/)
    : [];
  const whitelisted = whitelistItems.some(function(item) {
    return testForMatch(item, url);
  }, this);
  return whitelisted;
};

export const removeFromWhitelist = url => {
  const oldWhitelistString = getOption(WHITELIST) || '';
  const whitelistItems = oldWhitelistString.split(/[\s\n]+/).sort();

  for (let i = whitelistItems.length - 1; i >= 0; i--) {
    if (testForMatch(whitelistItems[i], url)) {
      whitelistItems.splice(i, 1);
    }
  }
  const whitelistString = whitelistItems.join('\n');
  setOptionAndSync(WHITELIST, whitelistString);

  const key = WHITELIST;
  performPostSaveUpdates(
    [key],
    { [key]: oldWhitelistString },
    { [key]: whitelistString }
  );
};

export const testForMatch = (whitelistItem, word) => {
  if (whitelistItem.length < 1) {
    return false;

    //test for regex ( must be of the form /foobar/ )
  } else if (
    whitelistItem.length > 2 &&
    whitelistItem.indexOf('/') === 0 &&
    whitelistItem.indexOf('/', whitelistItem.length - 1) !== -1
  ) {
    whitelistItem = whitelistItem.substring(1, whitelistItem.length - 1);
    try {
      new RegExp(whitelistItem); // eslint-disable-line no-new
    } catch (e) {
      return false;
    }
    return new RegExp(whitelistItem).test(word);

    // test as substring
  } else {
    return word.indexOf(whitelistItem) >= 0;
  }
};

export const saveToWhitelist = newString => {
  const oldWhitelistString = getOption(WHITELIST) || '';
  let newWhitelistString = oldWhitelistString + '\n' + newString;
  newWhitelistString = cleanupWhitelist(newWhitelistString);
  setOptionAndSync(WHITELIST, newWhitelistString);

  const key = WHITELIST;
  performPostSaveUpdates(
    [key],
    { [key]: oldWhitelistString },
    { [key]: newWhitelistString }
  );
};

export const cleanupWhitelist = whitelist => {
  const whitelistItems = whitelist ? whitelist.split(/[\s\n]+/).sort() : '';

  for (let i = whitelistItems.length - 1; i >= 0; i--) {
    const j = whitelistItems.lastIndexOf(whitelistItems[i]);
    if (j !== i) {
      whitelistItems.splice(i + 1, j - i);
    }
    if (!whitelistItems[i] || whitelistItems[i] === '') {
      whitelistItems.splice(i, 1);
    }
  }
  if (whitelistItems.length) {
    return whitelistItems.join('\n');
  } else {
    return whitelistItems;
  }
};

export const documentReadyAsPromsied = doc => {
  return new Promise(function(resolve) {
    if (doc.readyState !== 'loading') {
      resolve();
    } else {
      doc.addEventListener('DOMContentLoaded', function() {
        resolve();
      });
    }
  });
};

export const localiseHtml = parentEl => {
  const replaceTagFunc = function(match, p1) {
    return p1 ? chrome.i18n.getMessage(p1) : '';
  };
  for (const el of parentEl.getElementsByTagName('*')) {
    if (el.hasAttribute('data-i18n')) {
      el.innerHTML = el
        .getAttribute('data-i18n')
        .replace(/__MSG_(\w+)__/g, replaceTagFunc)
        .replace(/\n/g, '<br />');
    }
    if (el.hasAttribute('data-i18n-tooltip')) {
      el.setAttribute(
        'data-i18n-tooltip',
        el
          .getAttribute('data-i18n-tooltip')
          .replace(/__MSG_(\w+)__/g, replaceTagFunc)
      );
    }
  }
};

export const documentReadyAndLocalisedAsPromsied = async doc => {
  await documentReadyAsPromsied(doc);
  localiseHtml(doc);
  if (doc.body && doc.body.hidden) {
    doc.body.hidden = false;
  }
};

export const getRootUrl = (url, includePath, includeScheme) => {
  let rootUrlStr = url;
  let scheme;

  // temporarily remove scheme
  if (rootUrlStr.indexOf('//') > 0) {
    scheme = rootUrlStr.substring(0, rootUrlStr.indexOf('//') + 2);
    rootUrlStr = rootUrlStr.substring(rootUrlStr.indexOf('//') + 2);
  }

  // remove path
  if (!includePath) {
    if (scheme === 'file://') {
      rootUrlStr = rootUrlStr.replace(new RegExp('/[^/]*$', 'g'), '');
    } else {
      const pathStartIndex =
        rootUrlStr.indexOf('/') > 0
          ? rootUrlStr.indexOf('/')
          : rootUrlStr.length;
      rootUrlStr = rootUrlStr.substring(0, pathStartIndex);
    }
  } else {
    // remove query string
    let match = rootUrlStr.match(/\/?[?#]+/);
    if (match) {
      rootUrlStr = rootUrlStr.substring(0, match.index);
    }
    // remove trailing slash
    match = rootUrlStr.match(/\/$/);
    if (match) {
      rootUrlStr = rootUrlStr.substring(0, match.index);
    }
  }

  // readd scheme
  if (scheme && includeScheme) {
    rootUrlStr = scheme + rootUrlStr;
  }
  return rootUrlStr;
};

export const generateEncodedQueryString = params => {
  return Object.keys(params)
    .map(k => k + '=' + encodeURIComponent(params[k]))
    .join('&');
};

export const parseEncodedQueryString = queryString => {
  const query = {};
  queryString = decodeEntities(queryString);

  const pairs = (queryString[0] === '?'
    ? queryString.substr(1)
    : queryString
  ).split('&');
  for (let i = 0; i < pairs.length; i++) {
    const splitIndex = pairs[i].indexOf('=');
    const pair = [
      pairs[i].substring(0, splitIndex),
      pairs[i].substring(splitIndex + 1),
    ];
    query[pair[0]] = decodeURIComponent(pair[1] || '');
  }
  return query;
};

const getIframeQueryParamsValue = (key, urlString) => {
  if (!urlString || urlString.length === 0) return false;

  const urlStringParts = urlString.split(
    `src="${INTERNAL_MSG_URL}${SUSPENDED_IFRAME_PREFIX}`
  );
  if (urlStringParts.length < 2) return false;

  const queryString = urlStringParts[1].split('"')[0];
  if (queryString.length === 0) return false;

  const queryParams = parseEncodedQueryString(queryString, true);
  return queryParams[key];
};

export const getTitleFromSuspendedUrl = urlStr => {
  return getIframeQueryParamsValue('t', decodeString(urlStr) || '');
};
export const getSettingsHashFromSuspendedUrl = urlStr => {
  return getIframeQueryParamsValue('i', decodeString(urlStr) || '');
};
export const getScrollPositionFromSuspendedUrl = urlStr => {
  return getIframeQueryParamsValue('p', decodeString(urlStr) || '');
};
export const getOriginalUrlFromSuspendedUrl = urlStr => {
  return getIframeQueryParamsValue('u', decodeString(urlStr) || '');
};
export const getCleanUrl = url => {
  // remove scheme
  if (url.indexOf('//') > 0) {
    url = url.substring(url.indexOf('//') + 2);
  }
  // remove query string
  let match = url.match(/\/?[?#]+/);
  if (match) {
    url = url.substring(0, match.index);
  }
  // remove trailing slash
  match = url.match(/\/$/);
  if (match) {
    url = url.substring(0, match.index);
  }
  return url;
};
export const getCleanTabTitle = tab => {
  let cleanedTitle = decodeString(tab.title);
  if (
    !cleanedTitle ||
    cleanedTitle === '' ||
    cleanedTitle === decodeString(tab.url) ||
    cleanedTitle === 'Suspended Tab'
  ) {
    if (isSuspendedTab(tab)) {
      // TODO: If url is a dataUrl, then use jsdom to get tab title from meta
      // cleanedTitle = getTitleFromSuspendedUrl(tab.url) || getOriginalUrlFromSuspendedUrl(tab.url);
      cleanedTitle = getOriginalUrlFromSuspendedUrl(tab.url);
    } else {
      cleanedTitle = tab.url;
    }
  }
  return cleanedTitle;
};
export const encodeEntities = string => {
  return string
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
};
export const decodeEntities = string => {
  return string
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
};

export const decodeString = string => {
  try {
    return decodeURIComponent(string);
  } catch (e) {
    return string;
  }
};
export const encodeString = string => {
  try {
    return encodeURIComponent(string);
  } catch (e) {
    return string;
  }
};
export const encodeStringForDataUrl = string => {
  // from here: https://stackoverflow.com/questions/9238890/convert-html-to-datatext-html-link-using-javascript
  return string
    .replace(/\s{2,}/g, '') // <-- Replace all consecutive spaces, 2+
    .replace(/%/g, '%25') // <-- Escape %
    .replace(/&/g, '%26') // <-- Escape &
    .replace(/#/g, '%23') // <-- Escape #
    .replace(/"/g, '%22') // <-- Escape "
    .replace(/'/g, '%27'); // <-- Escape ' (to be 100% safe)
};

export const formatHotkeyString = hotkeyString => {
  return hotkeyString
    .replace(/Command/, '⌘')
    .replace(/[⌘\u2318]/, ' ⌘ ')
    .replace(/[⇧\u21E7]/, ' Shift ')
    .replace(/[⌃\u8963]/, ' Ctrl ')
    .replace(/[⌥\u8997]/, ' Option ')
    .replace(/\+/g, ' ')
    .replace(/ +/g, ' ')
    .trim()
    .replace(/[ ]/g, ' \u00B7 ');
};

export const getSuspendedTabCount = async () => {
  const currentTabs = await tabsQuery();
  const currentSuspendedTabs = currentTabs.filter(tab => isSuspendedTab(tab));
  return currentSuspendedTabs.length;
};

export const htmlEncode = text => {
  return document
    .createElement('pre')
    .appendChild(document.createTextNode(text)).parentNode.innerHTML;
};

export const getChromeVersion = () => {
  const raw = navigator.userAgent.match(/Chrom(e|ium)\/([0-9]+)\./);
  return raw ? parseInt(raw[2], 10) : false;
};

export const generateHashCode = text => {
  let hash = 0;
  if (!text) return hash;
  for (let i = 0, len = text.length; i < len; i++) {
    const chr = text.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash);
};

export const getAllExpiredTabs = callback => {
  const expiredTabs = [];
  chrome.tabs.query({}, tabs => {
    for (const tab of tabs) {
      const timerDetails = getTabStatePropForTabId(tab.id, STATE_TIMER_DETAILS);
      if (
        timerDetails &&
        timerDetails.suspendDateTime &&
        new Date(timerDetails.suspendDateTime) < new Date()
      ) {
        expiredTabs.push(tab);
      }
    }
    callback(expiredTabs);
  });
};

export const performPostSaveUpdates = (
  changedSettingKeys,
  oldValueBySettingKey,
  newValueBySettingKey
) => {
  chrome.tabs.query({}, function(tabs) {
    tabs.forEach(function(tab) {
      if (isSpecialTab(tab)) {
        return;
      }

      if (isSuspendedTab(tab)) {
        //If toggling IGNORE_PINNED or IGNORE_ACTIVE_TABS to TRUE, then unsuspend any suspended pinned/active tabs
        if (
          (changedSettingKeys.includes(IGNORE_PINNED) &&
            isProtectedPinnedTab(tab)) ||
          (changedSettingKeys.includes(IGNORE_ACTIVE_TABS) &&
            isProtectedActiveTab(tab))
        ) {
          unsuspendTab(tab);
          return;
        }

        //if theme or screenshot preferences have changed then refresh suspended tabs
        const _updateTheme = changedSettingKeys.includes(THEME);
        const _updatePreviewMode = changedSettingKeys.includes(SCREEN_CAPTURE);
        if (_updateTheme || _updatePreviewMode) {
          buildSettingsStateHash(); // async. unhandled promise.
        }
        return;
      }

      if (!isNormalTab(tab, true)) {
        return;
      }

      //update content scripts of normal tabs
      const updateIgnoreForms = changedSettingKeys.includes(IGNORE_FORMS);
      if (updateIgnoreForms) {
        sendUpdateToContentScriptOfTab(tab); //async. unhandled error
      }

      //update suspend timers
      const updateSuspendTime =
        changedSettingKeys.includes(SUSPEND_TIME) ||
        (changedSettingKeys.includes(IGNORE_ACTIVE_TABS) && tab.active) ||
        (changedSettingKeys.includes(IGNORE_PINNED) &&
          !getOption(IGNORE_PINNED) &&
          tab.pinned) ||
        (changedSettingKeys.includes(IGNORE_AUDIO) &&
          !getOption(IGNORE_AUDIO) &&
          tab.audible) ||
        (changedSettingKeys.includes(IGNORE_WHEN_OFFLINE) &&
          !getOption(IGNORE_WHEN_OFFLINE) &&
          !navigator.onLine) ||
        (changedSettingKeys.includes(IGNORE_WHEN_CHARGING) &&
          !getOption(IGNORE_WHEN_CHARGING) &&
          isCharging()) ||
        (changedSettingKeys.includes(WHITELIST) &&
          checkSpecificWhiteList(tab.url, oldValueBySettingKey[WHITELIST]) &&
          !checkSpecificWhiteList(tab.url, newValueBySettingKey[WHITELIST]));
      if (updateSuspendTime) {
        resetAutoSuspendTimerForTab(tab);
      }

      //if SuspendInPlaceOfDiscard has changed then updated discarded tabs
      const updateSuspendInPlaceOfDiscard = changedSettingKeys.includes(
        SUSPEND_IN_PLACE_OF_DISCARD
      );
      if (updateSuspendInPlaceOfDiscard && isDiscardedTab(tab)) {
        //TODO: Remove this code?
        // handleDiscardedUnsuspendedTab(tab); //async. unhandled promise.
        //note: this may cause the tab to suspend
      }

      //if we aren't resetting the timer on this tab, then check to make sure it does not have an expired timer
      //should always be caught by tests above, but we'll check all tabs anyway just in case
      // if (!updateSuspendTime) {
      //     fixme: this is now a promise, not a callback func.
      //     sendRequestInfoToContentScript(tab.id, function (err, tabInfo) { // unhandled error
      //         calculateTabStatus(tab, tabInfo, function (tabStatus) {
      //             if (tabStatus === STATUS_NORMAL && tabInfo && tabInfo.timerUp && (new Date(tabInfo.timerUp)) < new Date()) {
      //                 error(tab.id, 'Tab has an expired timer!', tabInfo);
      //                 fixme: this is now a promise, not a callback func.
      //                 sendUpdateToContentScriptOfTab(tab, true, false); // async. unhandled error
      //             }
      //         });
      //     });
      // }
    });
  });

  //if context menu has been disabled then remove from chrome
  if (contains(changedSettingKeys, ADD_CONTEXT)) {
    const addContextMenu = getOption(ADD_CONTEXT);
    buildContextMenu(addContextMenu);
  }

  //if screenshot preferences have changed then update the queue parameters
  if (
    contains(changedSettingKeys, SCREEN_CAPTURE) ||
    contains(changedSettingKeys, SCREEN_CAPTURE_FORCE)
  ) {
    gsTabSuspendManagerInit(); //async. unhandled promise
  }
};

export const getWindowFromSession = (windowId, session) => {
  let window = false;
  session.windows.some(function(curWindow) {
    //leave this as a loose matching as sometimes it is comparing strings. other times ints
    if (curWindow.id == windowId) {
      // eslint-disable-line eqeqeq
      window = curWindow;
      return true;
    }
  });
  return window;
};

export const removeInternalUrlsFromSession = session => {
  if (!session || !session.windows) {
    return;
  }
  for (let i = session.windows.length - 1; i >= 0; i--) {
    const curWindow = session.windows[i];
    for (let j = curWindow.tabs.length - 1; j >= 0; j--) {
      const curTab = curWindow.tabs[j];
      if (isInternalTab(curTab)) {
        curWindow.tabs.splice(j, 1);
      }
    }
    if (curWindow.tabs.length === 0) {
      session.windows.splice(i, 1);
    }
  }
};

export const getSimpleDate = date => {
  const d = new Date(date);
  return (
    ('0' + d.getDate()).slice(-2) +
    '-' +
    ('0' + (d.getMonth() + 1)).slice(-2) +
    '-' +
    d.getFullYear() +
    ' ' +
    ('0' + d.getHours()).slice(-2) +
    ':' +
    ('0' + d.getMinutes()).slice(-2)
  );
};

export const getHumanDate = date => {
  const monthNames = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const d = new Date(date);
  const currentDate = d.getDate();
  const currentMonth = d.getMonth();
  const currentYear = d.getFullYear();
  const currentHours = d.getHours();
  const currentMinutes = d.getMinutes();

  // const suffix;
  // if (currentDate === 1 || currentDate === 21 || currentDate === 31) {
  //     suffix = 'st';
  // } else if (currentDate === 2 || currentDate === 22) {
  //     suffix = 'nd';
  // } else if (currentDate === 3 || currentDate === 23) {
  //     suffix = 'rd';
  // } else {
  //     suffix = 'th';
  // }

  const ampm = currentHours >= 12 ? 'pm' : 'am';
  const hoursString = currentHours % 12 || 12;
  const minutesString = ('0' + currentMinutes).slice(-2);

  return (
    currentDate +
    ' ' +
    monthNames[currentMonth] +
    ' ' +
    currentYear +
    ' ' +
    hoursString +
    ':' +
    minutesString +
    ampm
  );
};

export const debounce = function(callback, wait) {
  let timeout;
  return (...args) => {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => callback.apply(context, args), wait);
  };
};

export const setTimeout = timeout => {
  return new Promise(resolve => {
    window.setTimeout(resolve, timeout);
  });
};

export const executeWithRetries = async (
  promiseFn,
  fnArgsArray,
  maxRetries,
  retryWaitTime
) => {
  const retryFn = async retries => {
    try {
      return await promiseFn(...fnArgsArray);
    } catch (e) {
      if (retries >= maxRetries) {
        warning('gsUtils', 'Max retries exceeded');
        return Promise.reject(e);
      }
      retries += 1;
      await setTimeout(retryWaitTime);
      return await retryFn(retries);
    }
  };
  const result = await retryFn(0);
  return result;
};

export const hasProperty = (obj, key) => {
  return typeof obj[key] !== 'undefined';
};
