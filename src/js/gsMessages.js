/*global gsUtils, gsSession, gsStorage */
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
    suspendTime,
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
    if (suspendTime !== null && !isNaN(Number(suspendTime))) {
      payload.suspendTime = suspendTime;
    }
    this.sendMessageToContentScript(tabId, payload, this.ERROR, callback);
  },

  sendResetTimerToAllContentScripts: function() {
    var self = this;
    var suspendTime = gsStorage.getOption(gsStorage.SUSPEND_TIME);

    chrome.tabs.query({}, function(tabs) {
      tabs.forEach(function(currentTab) {
        self.sendMessageToContentScript(
          currentTab.id,
          { suspendTime: suspendTime },
          this.WARNING,
          function(err) {
            if (err) {
              gsUtils.log(
                currentTab.id,
                'Failed to resetContentScript. Tab is probably loading?',
                err
              );
            }
          }
        );
      });
    });
  },

  sendUpdateToContentScriptOfTab: function(
    tab,
    updateSuspendTime,
    updateIgnoreForms
  ) {
    var self = this;
    var suspendTime = gsStorage.getOption(gsStorage.SUSPEND_TIME);
    var ignoreForms = gsStorage.getOption(gsStorage.IGNORE_FORMS);

    if (
      gsUtils.isSpecialTab(tab) ||
      gsUtils.isSuspendedTab(tab) ||
      gsUtils.isDiscardedTab(tab)
    ) {
      return;
    }

    let tabPayload = {};
    let tabSuspendTime = gsUtils.isProtectedActiveTab(tab) ? '0' : suspendTime;
    if (updateSuspendTime) {
      tabPayload.suspendTime = tabSuspendTime;
    }
    if (updateIgnoreForms) {
      tabPayload.ignoreForms = ignoreForms;
      if (!ignoreForms) {
        tabPayload.ignoredFormsSuspendTime = tabSuspendTime;
      }
    }
    self.sendMessageToContentScript(tab.id, tabPayload, this.WARNING);
  },

  sendClearTimerToContentScript: function(tabId, callback) {
    this.sendMessageToContentScript(
      tabId,
      {
        suspendTime: '0',
      },
      this.WARNING,
      callback
    );
  },

  sendRestartTimerToContentScript: function(tabId, callback) {
    this.sendMessageToContentScript(
      tabId,
      {
        suspendTime: gsStorage.getOption(gsStorage.SUSPEND_TIME),
      },
      this.WARNING,
      callback
    );
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
        if (severity === gsMessages.ERROR && !gsSession.isInitialising()) {
          gsUtils.error(
            tabId,
            '\n\n------------------------------------------------\n' +
              'Failed to communicate with contentScript!\n' +
              '------------------------------------------------\n\n'
          );
        }
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

  sendRefreshToAllSuspendedTabs: function(payload, callback) {
    var self = this;
    chrome.tabs.query({}, function(tabs) {
      tabs.forEach(function(tab) {
        if (gsUtils.isSuspendedTab(tab)) {
          self.sendUpdateSuspendedTab(tab.id, payload, callback);
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

  sendReloadOptionsToOptionsTab: function(tabId, callback) {
    this.sendMessageToTab(
      tabId,
      {
        action: 'reloadOptions',
      },
      this.INFO,
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

  sendTabInfoToRecoveryTab: function(recoveryTabId, tab) {
    var payload = { recoveredTab: tab };
    this.sendMessageToTab(recoveryTabId, payload, this.INFO);
  },

  sendMessageToTab: function(tabId, message, severity, callback) {
    var responseHandler = function(response) {
      gsUtils.log(tabId, 'response from tab', response);
      if (chrome.runtime.lastError) {
        if (severity === gsMessages.ERROR) {
          gsUtils.errorIfInitialised(tabId, chrome.runtime.lastError, message);
        } else if (severity === gsMessages.WARNING) {
          gsUtils.log(tabId, chrome.runtime.lastError.message, message);
        }
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
      gsUtils.error(tabId, e);
      chrome.tabs.sendMessage(tabId, message, responseHandler);
    }
  },

  executeScriptOnTab: function(tabId, scriptPath, callback) {
    chrome.tabs.executeScript(tabId, { file: scriptPath }, function(response) {
      if (chrome.runtime.lastError) {
        gsUtils.errorIfInitialised(
          tabId,
          'Could not inject ' + scriptPath + ' into tab.',
          chrome.runtime.lastError
        );
        if (callback) callback(chrome.runtime.lastError);
      } else {
        if (callback) callback(null, response);
      }
    });
  },

  executeCodeOnTab: function(tabId, codeString, callback) {
    chrome.tabs.executeScript(tabId, { code: codeString }, function(response) {
      if (chrome.runtime.lastError) {
        gsUtils.error(
          tabId,
          'Could not inject code into tab.',
          chrome.runtime.lastError
        );
        if (callback) callback(chrome.runtime.lastError);
      } else {
        if (callback) callback(null, response);
      }
    });
  },
};
