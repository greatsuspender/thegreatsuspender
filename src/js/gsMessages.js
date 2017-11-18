/*global gsUtils, gsStorage */
var gsMessages = { // eslint-disable-line no-unused-vars

    INFO: 'info',
    WARNING: 'warning',
    ERROR: 'error',

    sendInitTabToContentScript(tabId, ignoreForms, tempWhitelist, scrollPos, suspendTime, callback) {
        var props = {
            ignoreForms: ignoreForms,
            tempWhitelist: tempWhitelist,
        };
        if (scrollPos) {
            props.scrollPos = scrollPos;
        }
        if (suspendTime) {
            props.suspendTime = suspendTime;
        }
        this.sendMessageToTab(tabId, props, this.ERROR, callback);
    },

    sendUpdatedPreferencesToContentScript: function (tabId, preferencesToUpdate, callback) {
        var messageParams = {};
        if (preferencesToUpdate.indexOf(gsStorage.SUSPEND_TIME) > -1) {
            messageParams.suspendTime = gsStorage.getOption(gsStorage.SUSPEND_TIME);
        }
        if (preferencesToUpdate.indexOf(gsStorage.IGNORE_FORMS) > -1) {
            messageParams.ignoreForms = gsStorage.getOption(gsStorage.IGNORE_FORMS);
        }
        this.sendMessageToTab(tabId, messageParams, this.WARNING, callback);
    },

    sendClearTimerToContentScript: function (tabId, callback) {
        this.sendMessageToTab(tabId, {
            suspendTime: false,
        }, this.WARNING, callback);
    },

    sendRestartTimerToContentScript: function (tabId, callback) {
        this.sendMessageToTab(tabId, {
            suspendTime: gsStorage.getOption(gsStorage.SUSPEND_TIME),
        }, this.WARNING, callback);
    },

    sendTemporaryWhitelistToContentScript: function (tabId, callback) {
        this.sendMessageToTab(tabId, {
            tempWhitelist: true,
        }, this.WARNING, callback);
    },

    sendUndoTemporaryWhitelistToContentScript: function (tabId, callback) {
        this.sendMessageToTab(tabId, {
            tempWhitelist: false,
        }, this.WARNING, callback);
    },

    sendRequestInfoToContentScript(tabId, callback) {
        this.sendMessageToTab(tabId, {
            action: 'requestInfo'
        }, this.ERROR, callback);
    },

    sendConfirmSuspendToContentScript: function (tabId, suspendedUrl, callback) {
        this.sendMessageToTab(tabId, {
            action: 'confirmTabSuspend',
            suspendedUrl: suspendedUrl,
        }, this.ERROR, callback);
    },

    sendGeneratePreviewToContentScript: function (tabId, screenCaptureMode, forceScreenCapture, callback) {
        this.sendMessageToTab(tabId, {
            action: 'generatePreview',
            screenCapture: screenCaptureMode,
            forceScreenCapture: forceScreenCapture
        }, this.ERROR, callback);
    },



    sendUnsuspendOnReloadValueToSuspendedTab: function (tabId, value, callback) {
        this.sendMessageToTab(tabId, {
            action: 'setUnsuspendOnReload',
            value: value
        }, this.ERROR, callback);
    },

    sendUnsuspendRequestToSuspendedTab: function (tabId, callback) {
        this.sendMessageToTab(tabId, {
            action: 'unsuspendTab'
        }, this.ERROR, callback);
    },

    sendNoConnectivityMessageToSuspendedTab: function (tabId, callback) {
        this.sendMessageToTab(tabId, {
            action: 'showNoConnectivityMessage'
        }, this.ERROR, callback);
    },



    sendReloadOptionsToOptionsTab: function (tabId, callback) {
        this.sendMessageToTab(tabId, {
            action: 'reloadOptions'
        }, this.INFO, callback);
    },



    sendPingToTab: function (tabId, callback) {
        this.sendMessageToTab(tabId, {
            action: 'ping'
        }, this.INFO, callback);
    },

    sendMessageToTab: function (tabId, message, severity, callback) {
        var responseHandler = function (response) {
            if (chrome.runtime.lastError) {
                if (severity === gsMessages.ERROR) {
                    gsUtils.error(chrome.runtime.lastError.message, tabId, message);
                } else if (severity === gsMessages.WARNING) {
                    gsUtils.log(chrome.runtime.lastError.message, tabId, message);
                }
                if (callback) callback(chrome.runtime.lastError);
            } else {
                if (callback) callback(null, response);
            }
        };

        message.tabId = tabId;
        try {
            chrome.tabs.sendMessage(tabId, message, {frameId: 0}, responseHandler);
        } catch (e) {
            gsUtils.error(e);
            chrome.tabs.sendMessage(tabId, message, responseHandler);
        }
    },

    executeScriptOnTab: function (tabId, scriptPath, callback) {
        chrome.tabs.executeScript(tabId, { file: scriptPath }, function (response) {
            if (chrome.runtime.lastError) {
                gsUtils.error('Could not inject ' + scriptPath + ' into tab: ' + tabId, chrome.runtime.lastError.message);
                if (callback) callback(chrome.runtime.lastError);
            } else {
                if (callback) callback(null, response);
            }
        });
    },
};
