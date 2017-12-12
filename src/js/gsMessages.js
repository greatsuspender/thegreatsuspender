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
        this.sendMessageToContentScript(tabId, props, this.ERROR, callback);
    },

    sendUpdatedPreferencesToContentScript: function (tabId, preferencesToUpdate, callback) {
        var messageParams = {};
        if (preferencesToUpdate.indexOf(gsStorage.SUSPEND_TIME) > -1) {
            messageParams.suspendTime = gsStorage.getOption(gsStorage.SUSPEND_TIME);
        }
        if (preferencesToUpdate.indexOf(gsStorage.IGNORE_FORMS) > -1) {
            messageParams.ignoreForms = gsStorage.getOption(gsStorage.IGNORE_FORMS);
        }
        this.sendMessageToContentScript(tabId, messageParams, this.WARNING, callback);
    },

    sendClearTimerToContentScript: function (tabId, callback) {
        this.sendMessageToContentScript(tabId, {
            suspendTime: false,
        }, this.WARNING, callback);
    },

    sendRestartTimerToContentScript: function (tabId, callback) {
        this.sendMessageToContentScript(tabId, {
            suspendTime: gsStorage.getOption(gsStorage.SUSPEND_TIME),
        }, this.WARNING, callback);
    },

    sendTemporaryWhitelistToContentScript: function (tabId, callback) {
        this.sendMessageToContentScript(tabId, {
            tempWhitelist: true,
        }, this.WARNING, callback);
    },

    sendUndoTemporaryWhitelistToContentScript: function (tabId, callback) {
        this.sendMessageToContentScript(tabId, {
            tempWhitelist: false,
        }, this.WARNING, callback);
    },

    sendRequestInfoToContentScript(tabId, callback) {
        this.sendMessageToContentScript(tabId, {
            action: 'requestInfo'
        }, this.ERROR, callback);
    },

    sendConfirmSuspendToContentScript: function (tabId, suspendedUrl, callback) {
        this.sendMessageToContentScript(tabId, {
            action: 'confirmTabSuspend',
            suspendedUrl: suspendedUrl,
        }, this.ERROR, callback);
    },

    sendGeneratePreviewToContentScript: function (tabId, screenCaptureMode, forceScreenCapture, callback) {
        this.sendMessageToContentScript(tabId, {
            action: 'generatePreview',
            screenCapture: screenCaptureMode,
            forceScreenCapture: forceScreenCapture
        }, this.ERROR, callback);
    },

    sendMessageToContentScript: function (tabId, message, severity, callback) {
        var self = this;
        // console.log(new Error('sendMessageToContentScript notActuallyError').stack);
        self.sendMessageToTab(tabId, message, severity, function (error, response) {
            if (error) {
                console.log('\n\n------------------------------------------------');
                console.log('Failed to communicate with contentScript!');
                console.log('------------------------------------------------\n\n');
                        if (callback) callback(error);
            } else {
                if (callback) callback(null, response);
            }
        });
    },


    sendInitSuspendedTab: function (tabId, tabProperties, callback) {
        this.sendMessageToTab(tabId, {
            action: 'initSuspendedTab',
            tabProperties: tabProperties
        }, this.ERROR, callback);
    },

    sendDisableUnsuspendOnReloadToSuspendedTab: function (tabId, callback) {
        this.sendMessageToTab(tabId, {
            action: 'disableUnsuspendOnReload',
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

    sendTabInfoToRecoveryTab: function (tabId, payload) {
        this.sendMessageToTab(tabId, payload, this.INFO);
    },

    sendMessageToTab: function (tabId, message, severity, callback) {
        var responseHandler = function (response) {
            gsUtils.log(tabId, 'response from tab', response);
            if (chrome.runtime.lastError) {
                if (severity === gsMessages.ERROR) {
                    gsUtils.error(tabId, chrome.runtime.lastError.message, message);
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
            chrome.tabs.sendMessage(tabId, message, {frameId: 0}, responseHandler);
        } catch (e) {
            gsUtils.error(tabId, e);
            chrome.tabs.sendMessage(tabId, message, responseHandler);
        }
    },

    executeScriptOnTab: function (tabId, scriptPath, callback) {
        chrome.tabs.executeScript(tabId, { file: scriptPath }, function (response) {
            if (chrome.runtime.lastError) {
                gsUtils.error(tabId, 'Could not inject ' + scriptPath + ' into tab.', chrome.runtime.lastError.message);
                if (callback) callback(chrome.runtime.lastError);
            } else {
                if (callback) callback(null, response);
            }
        });
    },
};
