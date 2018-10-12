/*global html2canvas, tgs, gsMessages, gsStorage, gsUtils, gsChrome, gsIndexedDb */
// eslint-disable-next-line no-unused-vars
var gsSuspendManager = (function() {
  'use strict';

  var MAX_TABS_IN_PROGRESS = 10;
  var IMAGE_RENDER_TIMEOUT = 60 * 1000;

  var processSuspensionQueueTimer;
  var suspensionQueueDetailsByTabId = {};

  function initAsPromised() {
    return new Promise(function(resolve) {
      var screenCaptureMode = gsStorage.getOption(gsStorage.SCREEN_CAPTURE);
      var forceScreenCapture = gsStorage.getOption(
        gsStorage.SCREEN_CAPTURE_FORCE
      );
      MAX_TABS_IN_PROGRESS = screenCaptureMode === '0' ? 5 : 3;
      IMAGE_RENDER_TIMEOUT = forceScreenCapture ? 5 * 60 * 1000 : 60 * 1000;
      resolve();
    });
  }

  function queueTabForSuspension(tab, forceLevel) {
    if (typeof tab === 'undefined') return;

    if (!checkTabEligibilityForSuspension(tab, forceLevel)) {
      gsUtils.log(tab.id, 'Tab not eligible for suspension.');
      return;
    }

    gsUtils.log(tab.id, 'Queueing tab for suspension.');

    suspensionQueueDetailsByTabId[tab.id] = {
      tab: tab,
      forceLevel: forceLevel,
    };
    clearTimeout(processSuspensionQueueTimer);
    processSuspensionQueueTimer = setTimeout(function() {
      gsUtils.log('background', 'processRequestTabSuspensionQueue');
      processRequestTabSuspensionQueue();
    }, 100);
  }

  function unqueueTabForSuspension(tab) {
    const suspensionDetails = suspensionQueueDetailsByTabId[tab.id];
    if (!suspensionDetails) {
      return;
    }
    gsUtils.log(tab.id, 'Tab suspension cancelled externally for tab.');
    removeTabFromSuspensionQueue(tab);
  }

  function executeTabSuspension(tab) {
    var suspensionDetails = suspensionQueueDetailsByTabId[tab.id];
    // If suspensionDetails doesn't exist, then assume this tab suspension has been cancelled
    if (!suspensionDetails) {
      gsUtils.log(
        tab.id,
        'Tab missing from suspensionQueue. Assuming suspension cancelled for this tab.'
      );
      return;
    }
    removeTabFromSuspensionQueue(tab);

    var suspendedUrl = suspensionDetails
      ? suspensionDetails.suspendedUrl
      : gsUtils.generateSuspendedUrl(tab.url, tab.title, 0);
    let discardInPlaceOfSuspend = gsStorage.getOption(
      gsStorage.DISCARD_IN_PLACE_OF_SUSPEND
    );

    // If we want to force tabs to be discarded instead of suspending them
    if (discardInPlaceOfSuspend) {
      forceTabDiscardation(tab);
    } else {
      gsMessages.sendConfirmSuspendToContentScript(
        tab.id,
        suspendedUrl,
        function(error) {
          if (error) {
            gsUtils.warning(
              tab.id,
              'Failed to sendConfirmSuspendToContentScript',
              error
            );
            forceTabSuspension(tab, suspendedUrl); // async. unhandled promise.
          }
        }
      );
    }
  }

  async function forceTabSuspension(tab, suspendedUrl) {
    if (!gsUtils.isSuspendedTab(tab)) {
      await gsChrome.tabsUpdate(tab.id, { url: suspendedUrl });
    } else {
      gsUtils.log(tab.id, 'Tab already suspended');
    }
  }

  function forceTabDiscardation(tab) {
    if (tab.active) {
      gsUtils.log(tab.id, 'Tab is active. Aborting discard.');
      return;
    }
    if (!gsUtils.isDiscardedTab(tab)) {
      gsUtils.log(tab.id, 'Forcing discarding of tab.');
      chrome.tabs.discard(tab.id, () => {
        if (chrome.runtime.lastError) {
          gsUtils.warning(tab.id, chrome.runtime.lastError);
        }
      });
    } else {
      gsUtils.log(tab.id, 'Tab already discarded');
    }
  }

  function undiscardTab(tab) {
    if (gsUtils.isDiscardedTab(tab)) {
      chrome.tabs.reload(tab.id, () => {
        if (chrome.runtime.lastError) {
          gsUtils.warning(tab.id, chrome.runtime.lastError);
        }
      });
    } else {
      gsUtils.log(tab.id, 'Tab not discarded');
    }
  }

  async function handleDiscardedUnsuspendedTab(tab, forceRefresh) {
    if (!gsUtils.shouldSuspendDiscardedTabs()) {
      if (forceRefresh) {
        gsUtils.log(tab.id, 'Forcing refresh of discarded unsuspended tab');
        await gsChrome.tabsUpdate(tab.id, { url: tab.url });
      } else {
        gsUtils.log(
          tab.id,
          'Suspend discarded tabs not enabled. Tab will remain discarded :('
        );
      }
      return;
    }

    // If we want to force tabs to be suspended instead of discarding them
    var tabEligibleForSuspension = checkTabEligibilityForSuspension(tab, 3);
    if (!tabEligibleForSuspension) {
      if (forceRefresh) {
        gsUtils.log(tab.id, 'Forcing refresh of discarded unsuspended tab');
        await gsChrome.tabsUpdate(tab.id, { url: tab.url });
      } else {
        gsUtils.log(
          tab.id,
          'Aborting suspendInPlaceOfDiscard as tab is not eligbable for suspension. Tab will remain discarded :('
        );
      }
      return;
    }

    tgs.setTabFlagForTabId(tab.id, tgs.SUSPEND_REASON, 3);
    var suspendedUrl = gsUtils.generateSuspendedUrl(tab.url, tab.title, 0);
    await forceTabSuspension(tab, suspendedUrl);
  }

  function removeTabFromSuspensionQueue(tab) {
    delete suspensionQueueDetailsByTabId[tab.id];
  }

  function processRequestTabSuspensionQueue() {
    var inProgressTabIds = [];
    var queuedTabIds = [];
    for (var tabId of Object.keys(suspensionQueueDetailsByTabId)) {
      const suspensionDetails = suspensionQueueDetailsByTabId[tabId];
      if (suspensionDetails.startDateTime) {
        if (
          new Date() - suspensionDetails.startDateTime >
          IMAGE_RENDER_TIMEOUT
        ) {
          gsUtils.warning(
            tabId,
            `Tab took more than ${IMAGE_RENDER_TIMEOUT /
              1000} seconds to suspend`
          );
          executeTabSuspension(suspensionDetails.tab);
        } else {
          inProgressTabIds.push(tabId);
        }
      } else {
        queuedTabIds.push(tabId);
      }
    }
    gsUtils.log(
      'gsSuspendManager',
      'inProgressTabIds: ' + inProgressTabIds.join(',')
    );
    gsUtils.log(
      'gsSuspendManager',
      'queuedTabIds size: ' + queuedTabIds.length
    );

    // Take tabs off the queue and ask them to suspend
    while (
      queuedTabIds.length > 0 &&
      inProgressTabIds.length < MAX_TABS_IN_PROGRESS
    ) {
      const tabIdToSuspend = queuedTabIds.splice(0, 1);
      inProgressTabIds.push(tabIdToSuspend);
      const suspensionDetails = suspensionQueueDetailsByTabId[tabIdToSuspend];
      suspensionDetails.startDateTime = new Date();
      requestTabSuspension(suspensionDetails);
    }
    if (Object.keys(suspensionQueueDetailsByTabId).length > 0) {
      clearTimeout(processSuspensionQueueTimer);
      processSuspensionQueueTimer = setTimeout(function() {
        processRequestTabSuspensionQueue();
      }, 500);
    }
  }

  function requestTabSuspension(suspensionDetails) {
    var tab = suspensionDetails.tab;
    var forceLevel = suspensionDetails.forceLevel;

    gsMessages.sendRequestInfoToContentScript(tab.id, function(error, tabInfo) {
      //TODO: Should we wait here for the tab to load? Doesnt seem to matter..
      if (error) {
        gsUtils.warning(tab.id, 'Failed to requestTabSuspension', error);
        // assume tab is still loading
        tabInfo = {
          status: 'loading',
          scrollPos: '0',
        };
      }
      if (
        !checkContentScriptEligibilityForSuspension(tabInfo.status, forceLevel)
      ) {
        gsUtils.log(
          tab.id,
          `Content script status of ${
            tabInfo.status
          } not eligible for suspension. Removing tab from suspensionQueue.`
        );
        removeTabFromSuspensionQueue(tab);
        return;
      }

      updateYouTubeUrlWithTimestamp(tab, function() {
        var suspensionDetails = suspensionQueueDetailsByTabId[tab.id] || {};
        suspensionDetails.scrollPos = tabInfo.scrollPos;
        suspensionDetails.suspendedUrl = gsUtils.generateSuspendedUrl(
          tab.url,
          tab.title,
          suspensionDetails.scrollPos
        );

        saveSuspendData(tab, function() {
          var screenCaptureMode = gsStorage.getOption(gsStorage.SCREEN_CAPTURE);
          if (screenCaptureMode === '0') {
            executeTabSuspension(tab);
          } else {
            generatePreviewImg(tab);
            // executeTabSuspension is called on the 'savePreviewData' message response
          }
        });
      });
    });
  }

  // forceLevel indicates which users preferences to respect when attempting to suspend the tab
  // 1: Suspend if at all possible
  // 2: Respect whitelist, temporary whitelist, form input, pinned tabs, audible preferences, and exclude current active tab
  // 3: Same as above (2), plus also respect internet connectivity, running on battery, and time to suspend=never preferences.
  function checkTabEligibilityForSuspension(tab, forceLevel) {
    if (forceLevel >= 1) {
      if (gsUtils.isSuspendedTab(tab) || gsUtils.isSpecialTab(tab)) {
        return false;
      }
    }
    if (forceLevel >= 2) {
      if (
        gsUtils.isProtectedActiveTab(tab) ||
        gsUtils.checkWhiteList(tab.url) ||
        gsUtils.isProtectedPinnedTab(tab) ||
        gsUtils.isProtectedAudibleTab(tab)
      ) {
        return false;
      }
    }
    if (forceLevel >= 3) {
      if (
        gsStorage.getOption(gsStorage.IGNORE_WHEN_OFFLINE) &&
        !navigator.onLine
      ) {
        return false;
      }
      if (
        gsStorage.getOption(gsStorage.IGNORE_WHEN_CHARGING) &&
        tgs.isCharging()
      ) {
        return false;
      }
      if (gsStorage.getOption(gsStorage.SUSPEND_TIME) === '0') {
        return false;
      }
    }
    return true;
  }

  function checkContentScriptEligibilityForSuspension(
    contentScriptStatus,
    forceLevel
  ) {
    if (
      forceLevel >= 2 &&
      (contentScriptStatus === gsUtils.STATUS_FORMINPUT ||
        contentScriptStatus === gsUtils.STATUS_TEMPWHITELIST)
    ) {
      return false;
    }
    return true;
  }

  function updateYouTubeUrlWithTimestamp(tab, callback) {
    if (tab.url.indexOf('https://www.youtube.com/watch') < 0) {
      callback();
      return;
    }

    gsMessages.executeCodeOnTab(
      tab.id,
      `(${fetchYouTubeTimestampContentScript})();`,
      function(error, response) {
        if (error) {
          gsUtils.warning(
            tab.id,
            'Failed to updateYouTubeUrlWithTimestamp',
            error
          );
          callback();
          return;
        }
        var timestamp = response;
        if (timestamp && timestamp > 0) {
          var youTubeUrl = new URL(tab.url);
          youTubeUrl.searchParams.set('t', timestamp + 's');
          tab.url = youTubeUrl.href;
        }
        callback();
      }
    );
  }

  function fetchYouTubeTimestampContentScript() {
    var videoEl = document.querySelector('video.video-stream.html5-main-video');
    var timestamp = videoEl ? videoEl.currentTime >> 0 : 0;
    return timestamp;
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
      windowId: tab.windowId,
    };

    //add suspend information to suspendedTabInfo
    gsIndexedDb.addSuspendedTabInfo(tabProperties).then(function() {
      if (typeof callback === 'function') callback();
    });
  }

  function generatePreviewImg(tab) {
    var screenCaptureMode = gsStorage.getOption(gsStorage.SCREEN_CAPTURE);
    var forceScreenCapture = gsStorage.getOption(
      gsStorage.SCREEN_CAPTURE_FORCE
    );
    gsMessages.executeScriptOnTab(tab.id, 'js/html2canvas.min.js', function(
      error
    ) {
      if (error) {
        gsUtils.warning(
          tab.id,
          'Failed to executeScriptOnTab: html2canvas',
          error
        );
        executeTabSuspension(tab);
        return;
      }
      gsMessages.executeCodeOnTab(
        tab.id,
        `(${generatePreviewImgContentScript})("${screenCaptureMode}", ${forceScreenCapture});`,
        function(error) {
          if (error) {
            gsUtils.warning(
              tab.id,
              'Failed to executeCodeOnTab: generatePreviewImgContentScript',
              error
            );
            executeTabSuspension(tab);
          }
        }
      );
    });
  }

  // eslint-disable-next-line no-unused-vars
  function generatePreviewImgContentScript(
    screenCaptureMode,
    forceScreenCapture
  ) {
    var MAX_CANVAS_HEIGHT = forceScreenCapture ? 10000 : 5000;
    var IMAGE_TYPE = 'image/webp';
    var IMAGE_QUALITY = forceScreenCapture ? 0.92 : 0.5;
    var height = 0;

    function sendResponse(errorMessage, dataUrl) {
      chrome.runtime.sendMessage({
        action: 'savePreviewData',
        previewUrl: dataUrl,
        errorMsg: errorMessage,
      });
    }

    //check where we need to capture the whole screen
    if (screenCaptureMode === '2') {
      height = Math.max(
        window.innerHeight,
        document.body.scrollHeight,
        document.body.offsetHeight,
        document.documentElement.clientHeight,
        document.documentElement.scrollHeight,
        document.documentElement.offsetHeight
      );
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
    })
      .then(function(canvas) {
        var dataUrl = canvas.toDataURL(IMAGE_TYPE, IMAGE_QUALITY);
        if (!dataUrl || dataUrl === 'data:,') {
          dataUrl = canvas.toDataURL();
        }
        if (!dataUrl || dataUrl === 'data:,') {
          sendResponse('Bad dataUrl: ' + dataUrl);
        } else {
          sendResponse(null, dataUrl);
        }
      })
      .catch(function(err) {
        sendResponse(err.message);
      });
  }
  return {
    initAsPromised,
    queueTabForSuspension,
    unqueueTabForSuspension,
    executeTabSuspension,
    checkTabEligibilityForSuspension,
    forceTabSuspension,
    forceTabDiscardation,
    undiscardTab,
    handleDiscardedUnsuspendedTab,
    saveSuspendData,
  };
})();
