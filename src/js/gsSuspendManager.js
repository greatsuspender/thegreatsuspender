/*global html2canvas, tgs, gsMessages, gsStorage, gsUtils */
var gsSuspendManager = (function () { // eslint-disable-line no-unused-vars
    'use strict';

    var MAX_TABS_IN_PROGRESS = 10;
    var IMAGE_RENDER_TIMEOUT = 60 * 1000;
    updateQueueParameters();

    var processSuspensionQueueTimer;
    var tabToSuspendDetailsByTabId = {};

    // forceLevel indicates which users preferences to respect when attempting to suspend the tab
    // 1: Suspend if at all possible
    // 2: Respect whitelist, temporary whitelist, form input, pinned tabs, audible preferences, and exclude active tabs
    // 3: Same as above (2), plus also respect internet connectivity and running on battery preferences.
    function queueTabForSuspension(tab, forceLevel) {
        if (typeof tab === 'undefined') return;

        tabToSuspendDetailsByTabId[tab.id] = { tab: tab, forceLevel: forceLevel };
        clearTimeout(processSuspensionQueueTimer);
        processSuspensionQueueTimer = setTimeout(function () {
            gsUtils.log('background', 'processRequestTabSuspensionQueue');
            processRequestTabSuspensionQueue();
        }, 100);
    }

    function executeTabSuspension(tab) {
        var suspensionDetails = tabToSuspendDetailsByTabId[tab.id];
        delete tabToSuspendDetailsByTabId[tab.id];
        var suspendedUrl = suspensionDetails ? suspensionDetails.suspendedUrl : gsUtils.generateSuspendedUrl(tab.url, tab.title, 0);
        gsMessages.sendConfirmSuspendToContentScript(tab.id, suspendedUrl, function (err) {
            if (err) chrome.tabs.update(tab.id, {url: suspendedUrl});
        });
    }

    function removeTabFromSuspensionQueue(tab, reason) {
        delete tabToSuspendDetailsByTabId[tab.id];
        gsUtils.log('gsSuspendManager', `Tab suspension cancelled for tab: ${tab.id}. Reason: ${reason}`);
    }

    function markTabAsSuspended(tab) {
        delete tabToSuspendDetailsByTabId[tab.id];
    }

    function updateQueueParameters() {
        var screenCaptureMode = gsStorage.getOption(gsStorage.SCREEN_CAPTURE);
        var forceScreenCapture = gsStorage.getOption(gsStorage.SCREEN_CAPTURE_FORCE);
        MAX_TABS_IN_PROGRESS = screenCaptureMode ? 3 : 5;
        IMAGE_RENDER_TIMEOUT = forceScreenCapture ? 5 * 60 * 1000 : 60 * 1000;
    }

    function processRequestTabSuspensionQueue() {
        var inProgressTabIds = [];
        var queuedTabIds = [];
        for (var tabId of Object.keys(tabToSuspendDetailsByTabId)) {
            var suspensionDetails = tabToSuspendDetailsByTabId[tabId];
            if (suspensionDetails.startDateTime) {
                if ((new Date() - suspensionDetails.startDateTime) > IMAGE_RENDER_TIMEOUT) {
                    gsUtils.log('gsSuspendManager', `Tab took more than ${IMAGE_RENDER_TIMEOUT/1000} seconds to suspend`);
                    executeTabSuspension(suspensionDetails.tab);
                } else {
                    inProgressTabIds.push(tabId);
                }
            } else {
                queuedTabIds.push(tabId);
            }
        }
        gsUtils.log('gsSuspendManager', 'inProgressTabIds size: ' + inProgressTabIds.length);
        gsUtils.log('gsSuspendManager', 'queuedTabIds size: ' + queuedTabIds.length);
        while (queuedTabIds.length > 0 && inProgressTabIds.length < MAX_TABS_IN_PROGRESS) {
            var tabIdToSuspend = queuedTabIds.splice(0, 1);
            inProgressTabIds.push(tabIdToSuspend);
            var tabToSuspendDetails = tabToSuspendDetailsByTabId[tabIdToSuspend];
            tabToSuspendDetails.startDateTime = new Date();
            requestTabSuspension(tabToSuspendDetails);
        }
        if (Object.keys(tabToSuspendDetailsByTabId).length > 0) {
            clearTimeout(processSuspensionQueueTimer);
            processSuspensionQueueTimer = setTimeout(function () {
                processRequestTabSuspensionQueue();
            }, 500);
        }
    }

    function requestTabSuspension(suspensionDetails) {
        var tab = suspensionDetails.tab;
        var forceLevel = suspensionDetails.forceLevel;

        if (!checkTabEligibilityForSuspension(tab, forceLevel)) {
            removeTabFromSuspensionQueue(tab, 'Tab not eligible for suspension');
            return;
        }

        gsMessages.sendRequestInfoToContentScript(tab.id, function (err, tabInfo) {
            tabInfo = tabInfo || {};
            var suspensionDetails = tabToSuspendDetailsByTabId[tab.id];
            suspensionDetails.status = tabInfo.status;
            suspensionDetails.scrollPos = tabInfo.scrollPos || '0';
            suspensionDetails.suspendedUrl = gsUtils.generateSuspendedUrl(tab.url, tab.title, suspensionDetails.scrollPos);

            if (!checkContentScriptEligibilityForSuspension(suspensionDetails.status, forceLevel)) {
                removeTabFromSuspensionQueue(tab, 'Content script not eligible for suspension');
                return;
            }

            saveSuspendData(tab, function () {
                var screenCaptureMode = gsStorage.getOption(gsStorage.SCREEN_CAPTURE);
                if (screenCaptureMode === '0') {
                    executeTabSuspension(tab);
                } else {
                    generatePreviewImg(tab);
                    // executeTabSuspension is called on the 'savePreviewData' message response
                }
            });
        });
    }

    function checkTabEligibilityForSuspension(tab, forceLevel) {
        if (forceLevel >= 1) {
            if (gsUtils.isSuspendedTab(tab) || gsUtils.isSpecialTab(tab) || gsUtils.isDiscardedTab(tab)) {
                return false;
            }
        }
        if (forceLevel >= 2) {
            if (tab.active || gsUtils.checkWhiteList(tab.url) || gsUtils.isPinnedTab(tab) || gsUtils.isAudibleTab(tab)) {
                return false;
            }
        }
        if (forceLevel >= 3) {
            if (gsStorage.getOption(gsStorage.ONLINE_CHECK) && !navigator.onLine) {
                return false;
            }
            if (gsStorage.getOption(gsStorage.BATTERY_CHECK) && tgs.isCharging()) {
                return false;
            }
        }
        return true;
    }

    function checkContentScriptEligibilityForSuspension(contentScriptStatus, forceLevel) {
        if (forceLevel >= 2 && (contentScriptStatus === 'formInput' || contentScriptStatus === 'tempWhitelist')) {
            return false;
        }
        return true;
    }

    function saveSuspendData(tab, callback) {
        var tabProperties;
        var favUrl;

        if (tab.incognito) {
            favUrl = tab.favIconUrl;
        } else {
            favUrl = 'chrome://favicon/size/16@2x/' + tab.url;
        }

        tabProperties = {
            date: new Date(),
            title: tab.title,
            url: tab.url,
            favicon: favUrl,
            pinned: tab.pinned,
            index: tab.index,
            windowId: tab.windowId
        };

        //add suspend information to suspendedTabInfo
        gsStorage.addSuspendedTabInfo(tabProperties, function () {
            if (typeof callback === 'function') callback();
        });
    }

    function generatePreviewImg(tab) {
        var screenCaptureMode = gsStorage.getOption(gsStorage.SCREEN_CAPTURE);
        var forceScreenCapture = gsStorage.getOption(gsStorage.SCREEN_CAPTURE_FORCE);
        chrome.tabs.getZoom(tab.id, function (zoomFactor) {
            if (!forceScreenCapture && zoomFactor !== 1) {
                removeTabFromSuspensionQueue(tab, 'Tab has a disallowed zoom setting.');
                return;
            }
            gsMessages.executeScriptOnTab(tab.id, 'js/html2canvas.min.js', function (error) {
                if (error) {
                    gsUtils.error('gsSuspendManager', error.message);
                    executeTabSuspension(tab);
                    return;
                }
                gsMessages.executeCodeOnTab(tab.id,
                    `(${executeContentScript})("${screenCaptureMode}", ${forceScreenCapture});`,
                    function (error) {
                        if (error) {
                            gsUtils.error('gsSuspendManager', error.message);
                            executeTabSuspension(tab);
                        }
                    });
            });
        });
    }

    // eslint-disable-next-line no-unused-vars
    function executeContentScript(screenCaptureMode, forceScreenCapture) {
        var MAX_CANVAS_HEIGHT = forceScreenCapture ? 10000 : 5000;
        var IMAGE_TYPE = 'image/webp';
        var IMAGE_QUALITY = forceScreenCapture ? 0.92 : 0.5;
        var height = 0;

        function sendResponse(errorMessage, dataUrl) {
            chrome.runtime.sendMessage({
                action: 'savePreviewData',
                previewUrl: dataUrl,
                errorMsg: errorMessage
            });
        }

        //check where we need to capture the whole screen
        if (screenCaptureMode === '2') {
            height = Math.max(window.innerHeight,
                document.body.scrollHeight,
                document.body.offsetHeight,
                document.documentElement.clientHeight,
                document.documentElement.scrollHeight,
                document.documentElement.offsetHeight);
            // cap the max height otherwise it fails to convert to a data url
            height = Math.min(height, MAX_CANVAS_HEIGHT);
        } else {
            height = window.innerHeight;
        }

        html2canvas(document.body, {
            height: height,
            width: document.body.clientWidth,
            logging: false,
            imageTimeout: 10000,
            removeContainer: false,
        }).then(function (canvas) {
            var dataUrl = canvas.toDataURL(IMAGE_TYPE, IMAGE_QUALITY);
            if (!dataUrl || dataUrl === 'data:,') {
                dataUrl = canvas.toDataURL();
            }
            if (!dataUrl || dataUrl === 'data:,') {
                sendResponse('Failed to generate dataUrl');
            } else {
                sendResponse(null, dataUrl);
            }
        }).catch(function (err) {
            sendResponse(err.message);
        });
    }
    return {
        queueTabForSuspension,
        markTabAsSuspended,
        executeTabSuspension,
        updateQueueParameters,
    };
}());
