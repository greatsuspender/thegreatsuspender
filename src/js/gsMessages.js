import { log, isSpecialTab, isSuspendedTab, isDiscardedTab } from './gsUtils';
import { getOption, IGNORE_FORMS } from './gsStorage';

const INFO = 'info';
const WARNING = 'warning';
const ERROR = 'error';

export const sendInitTabToContentScript = (
  tabId,
  ignoreForms,
  tempWhitelist,
  scrollPos,
  callback
) => {
  const payload = {
    ignoreForms: ignoreForms,
    tempWhitelist: tempWhitelist,
  };
  if (scrollPos) {
    payload.scrollPos = scrollPos;
  }
  sendMessageToContentScript(tabId, payload, ERROR, callback);
};

export const sendUpdateToContentScriptOfTab = tab => {
  if (isSpecialTab(tab) || isSuspendedTab(tab, true) || isDiscardedTab(tab)) {
    return;
  }

  const ignoreForms = getOption(IGNORE_FORMS);
  sendMessageToContentScript(tab.id, { ignoreForms }, WARNING);
};

export const sendTemporaryWhitelistToContentScript = (tabId, callback) => {
  sendMessageToContentScript(
    tabId,
    {
      tempWhitelist: true,
    },
    WARNING,
    callback
  );
};

export const sendUndoTemporaryWhitelistToContentScript = (tabId, callback) => {
  sendMessageToContentScript(
    tabId,
    {
      tempWhitelist: false,
    },
    WARNING,
    callback
  );
};

export const sendRequestInfoToContentScript = (tabId, callback) => {
  sendMessageToContentScript(
    tabId,
    {
      action: 'requestInfo',
    },
    WARNING,
    callback
  );
};

export const sendMessageToContentScript = (
  tabId,
  message,
  severity,
  callback
) => {
  sendMessageToTab(tabId, message, severity, function(error, response) {
    if (error) {
      if (callback) callback(error);
    } else {
      if (callback) callback(null, response);
    }
  });
};

export const sendPingToTab = (tabId, callback) => {
  sendMessageToTab(
    tabId,
    {
      action: 'ping',
    },
    INFO,
    callback
  );
};

export const sendMessageToTab = (tabId, message, severity, callback) => {
  if (!tabId) {
    if (callback) callback('tabId not specified');
    return;
  }
  const responseHandler = function(response) {
    log(tabId, 'response from tab', response);
    if (chrome.runtime.lastError) {
      if (callback) callback(chrome.runtime.lastError);
    } else {
      if (callback) callback(null, response);
    }
  };

  message.tabId = tabId;
  try {
    log(tabId, 'send message to tab', message);
    chrome.tabs.sendMessage(tabId, message, { frameId: 0 }, responseHandler);
  } catch (e) {
    // error(tabId, e);
    chrome.tabs.sendMessage(tabId, message, responseHandler);
  }
};

export const executeScriptOnTab = (tabId, scriptPath, callback) => {
  if (!tabId) {
    if (callback) callback('tabId not specified');
    return;
  }
  chrome.tabs.executeScript(tabId, { file: scriptPath }, function(response) {
    if (chrome.runtime.lastError) {
      if (callback) callback(chrome.runtime.lastError);
    } else {
      if (callback) callback(null, response);
    }
  });
};

export const executeCodeOnTab = (tabId, codeString, callback) => {
  if (!tabId) {
    if (callback) callback('tabId not specified');
    return;
  }
  chrome.tabs.executeScript(tabId, { code: codeString }, function(response) {
    if (chrome.runtime.lastError) {
      if (callback) callback(chrome.runtime.lastError);
    } else {
      if (callback) callback(null, response);
    }
  });
};
