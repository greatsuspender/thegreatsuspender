/*global gsUtils, gsStorage */
// eslint-disable-next-line no-unused-vars
var gsMessages = {
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',

  sendInitTabToContentScript(
    tabId,
    ignoreForms,
    tempWhitelist,
    scrollPos,
    callback
  ) {
    var payload = {
      action: 'initialiseContentScript',
      ignoreForms: ignoreForms,
      tempWhitelist: tempWhitelist,
    };
    if (scrollPos) {
      payload.scrollPos = scrollPos;
    }
    this.sendMessageToContentScript(tabId, payload, this.ERROR, callback);
  },

  sendUpdateToContentScriptOfTab: function(tab) {
    if (
      gsUtils.isSpecialTab(tab) ||
      gsUtils.isSuspendedTab(tab) ||
      gsUtils.isDiscardedTab(tab)
    ) {
      return;
    }

    const ignoreForms = gsStorage.getOption(gsStorage.IGNORE_FORMS);
    this.sendMessageToContentScript(tab.id, { ignoreForms }, this.WARNING);
  },

  sendTemporaryWhitelistToContentScript: function(tabId, callback) {
    this.sendMessageToContentScript(
      tabId,
      {
        tempWhitelist: true,
      },
      this.WARNING,
      callback
    );
  },

  sendUndoTemporaryWhitelistToContentScript: function(tabId, callback) {
    this.sendMessageToContentScript(
      tabId,
      {
        tempWhitelist: false,
      },
      this.WARNING,
      callback
    );
  },

  sendRequestInfoToContentScript(tabId, callback) {
    this.sendMessageToContentScript(
      tabId,
      {
        action: 'requestInfo',
      },
      this.WARNING,
      callback
    );
  },

  sendConfirmSuspendToContentScript: function(tabId, suspendedUrl, callback) {
    this.sendMessageToContentScript(
      tabId,
      {
        action: 'confirmTabSuspend',
        suspendedUrl: suspendedUrl,
      },
      this.ERROR,
      callback
    );
  },

  sendMessageToContentScript: function(tabId, message, severity, callback) {
    var self = this;
    self.sendMessageToTab(tabId, message, severity, function(error, response) {
      if (error) {
        if (callback) callback(error);
      } else {
        if (callback) callback(null, response);
      }
    });
  },

  sendInitSuspendedTab: function(tabId, payload, callback) {
    callback = callback || function() {};
    payload = payload || {};
    payload.action = 'initSuspendedTab';
    this.sendMessageToTab(tabId, payload, this.ERROR, callback);
  },

  sendUpdateSuspendedTab: function(tabId, payload, callback) {
    callback = callback || function() {};
    payload = payload || {};
    payload.action = 'updateSuspendedTab';
    this.sendMessageToTab(tabId, payload, this.ERROR, callback);
  },

  sendRefreshToAllSuspendedTabs: function(payload) {
    var self = this;
    chrome.tabs.query({}, function(tabs) {
      tabs.forEach(function(tab) {
        if (gsUtils.isSuspendedTab(tab)) {
          self.sendUpdateSuspendedTab(tab.id, payload); //async
        }
      });
    });
  },

  sendDisableUnsuspendOnReloadToSuspendedTab: function(tabId, callback) {
    this.sendMessageToTab(
      tabId,
      {
        action: 'disableUnsuspendOnReload',
      },
      this.ERROR,
      callback
    );
  },

  sendUnsuspendRequestToSuspendedTab: function(tabId, callback) {
    this.sendMessageToTab(
      tabId,
      {
        action: 'unsuspendTab',
      },
      this.ERROR,
      callback
    );
  },

  sendTemporaryWhitelistToSuspendedTab: function(tabId, callback) {
    this.sendMessageToTab(
      tabId,
      {
        action: 'tempWhitelist',
      },
      this.ERROR,
      callback
    );
  },

  sendNoConnectivityMessageToSuspendedTab: function(tabId, callback) {
    this.sendMessageToTab(
      tabId,
      {
        action: 'showNoConnectivityMessage',
      },
      this.ERROR,
      callback
    );
  },

  sendPingToTab: function(tabId, callback) {
    this.sendMessageToTab(
      tabId,
      {
        action: 'ping',
      },
      this.INFO,
      callback
    );
  },

  sendUpdateCompleteToUpdatedTab: function(updatedTabId, callback) {
    var payload = { updateComplete: true };
    this.sendMessageToTab(updatedTabId, payload, this.INFO, callback);
  },

  sendMessageToTab: function(tabId, message, severity, callback) {
    if (!tabId) {
      if (callback) callback('tabId not specified');
      return;
    }
    var responseHandler = function(response) {
      gsUtils.log(tabId, 'response from tab', response);
      if (chrome.runtime.lastError) {
        if (callback) callback(chrome.runtime.lastError);
      } else {
        if (callback) callback(null, response);
      }
    };

    message.tabId = tabId;
    try {
      gsUtils.log(tabId, 'send message to tab', message);
      chrome.tabs.sendMessage(tabId, message, { frameId: 0 }, responseHandler);
    } catch (e) {
      // gsUtils.error(tabId, e);
      chrome.tabs.sendMessage(tabId, message, responseHandler);
    }
  },

  executeScriptOnTab: function(tabId, scriptPath, callback) {
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
  },

  executeCodeOnTab: function(tabId, codeString, callback) {
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
  },
};
