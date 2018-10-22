/*global html2canvas, tgs, gsMessages, gsStorage, gsUtils, gsChrome, gsIndexedDb, gsTabDiscardManager, GsTabQueue */
// eslint-disable-next-line no-unused-vars
var gsTabSuspendManager = (function() {
  'use strict';

  const DEFAULT_CONCURRENT_SUSPENSIONS = 3;
  const DEFAULT_SUSPENSION_TIMEOUT = 60 * 1000;
  const DEFAULT_SUSPENSION_REQUEUES = 0;

  let suspensionQueue;

  function initAsPromised() {
    return new Promise(function(resolve) {
      const screenCaptureMode = gsStorage.getOption(gsStorage.SCREEN_CAPTURE);
      const forceScreenCapture = gsStorage.getOption(
        gsStorage.SCREEN_CAPTURE_FORCE
      );
      const queueProps = {
        concurrentExecutors:
          screenCaptureMode === '0' ? 5 : DEFAULT_CONCURRENT_SUSPENSIONS,
        executorTimeout: forceScreenCapture
          ? 5 * 60 * 1000
          : DEFAULT_SUSPENSION_TIMEOUT,
        maxRequeueAttempts: DEFAULT_SUSPENSION_REQUEUES,
        executorFn: performSuspension,
        exceptionFn: handleSuspensionException,
      };
      suspensionQueue = GsTabQueue('suspensionQueue', queueProps);
      resolve();
    });
  }

  function queueTabForSuspension(tab, forceLevel) {
    queueTabForSuspensionAsPromise(tab, forceLevel);
  }

  function queueTabForSuspensionAsPromise(tab, forceLevel) {
    if (typeof tab === 'undefined') return;

    if (!checkTabEligibilityForSuspension(tab, forceLevel)) {
      gsUtils.log(tab.id, 'Tab not eligible for suspension.');
      return;
    }

    gsUtils.log(tab.id, 'Queueing tab for suspension.');
    return suspensionQueue.queueTabAsPromise(tab, { forceLevel });
  }

  function unqueueTabForSuspension(tab) {
    const removed = suspensionQueue.unqueueTab(tab);
    if (removed) {
      gsUtils.log(tab.id, `Removed tab from suspension queue.`);
    }
  }

  async function performSuspension(
    tab,
    executionProps,
    resolve,
    reject,
    requeue
  ) {
    const tabInfo = await getContentScriptTabInfo(tab);
    const isEligible = checkContentScriptEligibilityForSuspension(
      tabInfo.status,
      executionProps.forceLevel
    );
    if (!isEligible) {
      gsUtils.log(
        tab.id,
        `Content script status of ${
          tabInfo.status
        } not eligible for suspension. Removing tab from suspensionQueue.`
      );
      resolve(false);
      return;
    }

    const updatedUrl = await generateUrlWithYouTubeTimestamp(tab);
    tab.url = updatedUrl;
    await saveSuspendData(tab);

    const suspendedUrl = gsUtils.generateSuspendedUrl(
      updatedUrl,
      tab.title,
      tabInfo.scrollPos
    );
    executionProps.suspendedUrl = suspendedUrl;

    const screenCaptureMode = gsStorage.getOption(gsStorage.SCREEN_CAPTURE);
    if (screenCaptureMode === '0') {
      await executeTabSuspension(tab, suspendedUrl);
      resolve(true);
      return;
    }

    try {
      // Hack. Save handle to resolve function so we can call it later
      executionProps.resolveFn = resolve;
      await requestGeneratePreviewImg(tab);
      // resumeQueuedTabSuspension is called on the 'savePreviewData' message response
      // this will refetch the queued tabDetails and call executionProps.resolveFn(true)
    } catch (error) {
      gsUtils.warning(tab.id, error);
      await executeTabSuspension(tab, suspendedUrl);
      resolve(true);
    }
  }

  async function resumeQueuedTabSuspension(tab) {
    const queuedTabDetails = suspensionQueue.getQueuedTabDetails(tab);
    if (!queuedTabDetails) {
      gsUtils.log(
        tab.id,
        'Tab missing from suspensionQueue. Assuming suspension cancelled for this tab.'
      );
      return;
    }
    await executeTabSuspension(
      tab,
      queuedTabDetails.executionProps.suspendedUrl
    );
    queuedTabDetails.executionProps.resolveFn(true);
  }

  async function handleSuspensionException(
    tab,
    executionProps,
    exceptionType,
    resolve,
    reject,
    requeue
  ) {
    if (exceptionType === suspensionQueue.EXCEPTION_TIMEOUT) {
      gsUtils.log(
        tab.id,
        `Tab took more than ${
          suspensionQueue.getQueueProperties().executorTimeout
        }ms to suspend. Will abort screen capture.`
      );
      await executeTabSuspension(tab, executionProps.suspendedUrl);
      resolve(true);
    } else {
      gsUtils.warning(tab.id, `Failed to suspend tab: ${exceptionType}`);
      resolve(false);
    }
  }

  function executeTabSuspension(tab, suspendedUrl) {
    return new Promise(resolve => {
      // If we want to force tabs to be discarded instead of suspending them
      let discardInPlaceOfSuspend = gsStorage.getOption(
        gsStorage.DISCARD_IN_PLACE_OF_SUSPEND
      );
      if (discardInPlaceOfSuspend) {
        gsTabDiscardManager.queueTabForDiscard(tab);
        resolve();
        return;
      }

      if (!suspendedUrl) {
        gsUtils.log('executionProps.suspendedUrl not set!');
        suspendedUrl = gsUtils.generateSuspendedUrl(tab.url, tab.title, 0);
      }

      gsMessages.sendConfirmSuspendToContentScript(
        tab.id,
        suspendedUrl,
        async error => {
          if (error) {
            gsUtils.warning(
              tab.id,
              'Failed to sendConfirmSuspendToContentScript',
              error
            );
            // Will not be able to use window.replace when forcing suspension
            await forceTabSuspension(tab, suspendedUrl);
          }
          resolve();
        }
      );
    });
  }

  async function forceTabSuspension(tab, suspendedUrl) {
    if (gsUtils.isSuspendedTab(tab)) {
      gsUtils.log(tab.id, 'Tab already suspended');
      return;
    }
    await gsChrome.tabsUpdate(tab.id, { url: suspendedUrl });
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

  function getContentScriptTabInfo(tab) {
    return new Promise(resolve => {
      gsMessages.sendRequestInfoToContentScript(tab.id, (error, tabInfo) => {
        //TODO: Should we wait here for the tab to load? Doesnt seem to matter..
        if (error) {
          gsUtils.warning(tab.id, 'Failed to get content script info', error);
          // continue here but will lose information about scroll position,
          // temp whitelist, and form input
          tabInfo = {
            status: 'loading',
            scrollPos: '0',
          };
        }
        resolve(tabInfo);
      });
    });
  }

  function generateUrlWithYouTubeTimestamp(tab) {
    return new Promise(resolve => {
      if (tab.url.indexOf('https://www.youtube.com/watch') < 0) {
        resolve(tab.url);
        return;
      }

      gsMessages.executeCodeOnTab(
        tab.id,
        `(${fetchYouTubeTimestampContentScript})();`,
        (error, response) => {
          if (error) {
            gsUtils.warning(tab.id, 'Failed to fetch YouTube timestamp', error);
          }
          if (!response) {
            resolve(tab.url);
            return;
          }

          const timestamp = response;
          const youTubeUrl = new URL(tab.url);
          youTubeUrl.searchParams.set('t', timestamp + 's');
          resolve(youTubeUrl.href);
        }
      );
    });
  }

  function fetchYouTubeTimestampContentScript() {
    const videoEl = document.querySelector('video.video-stream.html5-main-video');
    const timestamp = videoEl ? videoEl.currentTime >> 0 : 0;
    return timestamp;
  }

  async function saveSuspendData(tab) {
    let favIconUrl;
    if (tab.incognito) {
      favIconUrl = tab.favIconUrl;
    } else {
      favIconUrl = 'chrome://favicon/size/16@2x/' + tab.url;
    }
    const tabProperties = {
      date: new Date(),
      title: tab.title,
      url: tab.url,
      favIconUrl: favIconUrl,
      pinned: tab.pinned,
      index: tab.index,
      windowId: tab.windowId,
    };
    await gsIndexedDb.addSuspendedTabInfo(tabProperties);
  }

  function requestGeneratePreviewImg(tab) {
    return new Promise((resolve, reject) => {
      const screenCaptureMode = gsStorage.getOption(gsStorage.SCREEN_CAPTURE);
      const forceScreenCapture = gsStorage.getOption(
        gsStorage.SCREEN_CAPTURE_FORCE
      );
      gsMessages.executeScriptOnTab(tab.id, 'js/html2canvas.min.js', error => {
        if (error) {
          reject('Failed to executeScriptOnTab: html2canvas');
          return;
        }
        gsMessages.executeCodeOnTab(
          tab.id,
          `(${generatePreviewImgContentScript})("${screenCaptureMode}", ${forceScreenCapture});`,
          error => {
            if (error) {
              reject(
                'Failed to executeCodeOnTab: generatePreviewImgContentScript'
              );
            } else {
              resolve();
            }
          }
        );
      });
    });
  }

  // eslint-disable-next-line no-unused-vars
  function generatePreviewImgContentScript(
    screenCaptureMode,
    forceScreenCapture
  ) {
    const MAX_CANVAS_HEIGHT = forceScreenCapture ? 10000 : 5000;
    const IMAGE_TYPE = 'image/webp';
    const IMAGE_QUALITY = forceScreenCapture ? 0.92 : 0.5;

    let height = 0;

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
        let dataUrl = canvas.toDataURL(IMAGE_TYPE, IMAGE_QUALITY);
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
    queueTabForSuspensionAsPromise,
    unqueueTabForSuspension,
    resumeQueuedTabSuspension,
    saveSuspendData,
    checkTabEligibilityForSuspension,
    forceTabSuspension,
  };
})();
