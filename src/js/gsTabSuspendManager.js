/*global html2canvas, domtoimage, tgs, gsMessages, gsStorage, gsUtils, gsChrome, gsIndexedDb, gsTabDiscardManager, GsTabQueue */
// eslint-disable-next-line no-unused-vars
var gsTabSuspendManager = (function() {
  'use strict';

  const DEFAULT_CONCURRENT_SUSPENSIONS = 3;
  const DEFAULT_SUSPENSION_TIMEOUT = 60 * 1000;
  const DEFAULT_FAVICON = chrome.extension.getURL('img/default.png');

  let suspensionQueue;

  function initAsPromised() {
    return new Promise(function(resolve) {
      const screenCaptureMode = gsStorage.getOption(gsStorage.SCREEN_CAPTURE);
      const forceScreenCapture = gsStorage.getOption(
        gsStorage.SCREEN_CAPTURE_FORCE
      );
      //TODO: This should probably update when the screencapture mode changes
      const concurrentSuspensions =
        screenCaptureMode === '0' ? 5 : DEFAULT_CONCURRENT_SUSPENSIONS;
      const suspensionTimeout = forceScreenCapture
        ? 5 * 60 * 1000
        : DEFAULT_SUSPENSION_TIMEOUT;
      const queueProps = {
        concurrentExecutors: concurrentSuspensions,
        jobTimeout: suspensionTimeout,
        executorFn: performSuspension,
        exceptionFn: handleSuspensionException,
      };
      suspensionQueue = GsTabQueue('suspensionQueue', queueProps);
      resolve();
    });
  }

  function queueTabForSuspension(tab, forceLevel) {
    queueTabForSuspensionAsPromise(tab, forceLevel).catch(e => {
      gsUtils.log(tab.id, e);
    });
  }

  function queueTabForSuspensionAsPromise(tab, forceLevel) {
    if (typeof tab === 'undefined') return Promise.resolve();

    if (!checkTabEligibilityForSuspension(tab, forceLevel)) {
      gsUtils.log(tab.id, 'Tab not eligible for suspension.');
      return Promise.resolve();
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
    const screenCaptureMode = gsStorage.getOption(gsStorage.SCREEN_CAPTURE);
    const tabInfo = await getContentScriptTabInfo(tab);

    // If we need to make a screen capture and tab is not responding then reload it
    // This is usually due to tab being discarded or 'parked' on chrome restart
    if (screenCaptureMode !== '0' && !tabInfo) {
      gsUtils.log(tab.id, 'Tab is not responding. Will reload for screen capture.');
      tgs.setUnsuspendedTabPropForTabId(
        tab.id,
        tgs.UTP_SUSPEND_ON_RELOAD_URL,
        tab.url
      );
      await gsChrome.tabsUpdate(tab.id, { url: tab.url });
      resolve(false);
      return;
    }

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

    if (screenCaptureMode === '0') {
      const success = await executeTabSuspension(tab, suspendedUrl);
      resolve(success);
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
      const success = await executeTabSuspension(tab, suspendedUrl);
      resolve(success);
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

    const success = await executeTabSuspension(
      tab,
      queuedTabDetails.executionProps.suspendedUrl
    );
    queuedTabDetails.executionProps.resolveFn(success);
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
          suspensionQueue.getQueueProperties().jobTimeout
        }ms to suspend. Will abort screen capture.`
      );
      const success = await executeTabSuspension(
        tab,
        executionProps.suspendedUrl
      );
      resolve(success);
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
          let success = true;
          if (error) {
            gsUtils.warning(
              tab.id,
              'Failed to sendConfirmSuspendToContentScript',
              error
            );
            // Will not be able to use window.replace when forcing suspension
            success = await forceTabSuspension(tab, suspendedUrl);
          }
          resolve(success);
        }
      );
    });
  }

  async function forceTabSuspension(tab, suspendedUrl) {
    if (gsUtils.isSuspendedTab(tab)) {
      gsUtils.log(tab.id, 'Tab already suspended');
      return;
    }
    const updatedTab = await gsChrome.tabsUpdate(tab.id, { url: suspendedUrl });
    return updatedTab !== null;
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
    const videoEl = document.querySelector(
      'video.video-stream.html5-main-video'
    );
    const timestamp = videoEl ? videoEl.currentTime >> 0 : 0;
    return timestamp;
  }

  async function saveSuspendData(tab) {
    let favIconUrl;
    if (tab.incognito) {
      favIconUrl = tab.favIconUrl;
    } else {
      favIconUrl = gsUtils.generateFaviconFromUrl(tab.url);
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
      const useAlternateScreenCaptureLib = gsStorage.getOption(
        gsStorage.USE_ALT_SCREEN_CAPTURE_LIB
      );
      const screenCaptureLib = useAlternateScreenCaptureLib
        ? 'js/dom-to-image.js'
        : 'js/html2canvas.min.js';
      gsUtils.log(tab.id, `Injecting ${screenCaptureLib} into content script`);
      const previewStartTime = Date.now();

      gsMessages.executeScriptOnTab(tab.id, screenCaptureLib, error => {
        if (error) {
          reject('Failed to executeScriptOnTab');
          return;
        }
        gsMessages.executeCodeOnTab(
          tab.id,
          `(${generatePreviewImgContentScript})("${screenCaptureMode}", ${forceScreenCapture}, ${useAlternateScreenCaptureLib});`,
          error => {
            const timeTaken = parseInt((Date.now() - previewStartTime) / 1000);
            gsUtils.log(
              tab.id,
              `Preview generation finished. Time taken: ${timeTaken}. Success: ${!error}`
            );
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
    forceScreenCapture,
    useAlternateScreenCaptureLib
  ) {
    const MAX_CANVAS_HEIGHT = forceScreenCapture ? 10000 : 5000;
    const IMAGE_TYPE = 'image/webp';
    const IMAGE_QUALITY = forceScreenCapture ? 0.92 : 0.5;

    let height = 0;
    let width = 0;

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
    width = document.body.clientWidth;

    let fetchCanvasAsPromise;
    if (useAlternateScreenCaptureLib) {
      fetchCanvasAsPromise = domtoimage
        .toCanvas(document.body, {})
        .then(canvas => {
          const croppedCanvas = document.createElement('canvas');
          const context = croppedCanvas.getContext('2d');
          croppedCanvas.width = width;
          croppedCanvas.height = height;
          context.drawImage(canvas, 0, 0);
          return croppedCanvas;
        });
    } else {
      fetchCanvasAsPromise = html2canvas(document.body, {
        height: height,
        width: width,
        // logging: true,
        imageTimeout: 10000,
        removeContainer: false,
        async: true,
      });
    }

    let dataUrl;
    let errorMsg;
    fetchCanvasAsPromise
      .then(function(canvas) {
        let _dataUrl = canvas.toDataURL(IMAGE_TYPE, IMAGE_QUALITY);
        if (!_dataUrl || _dataUrl === 'data:,') {
          _dataUrl = canvas.toDataURL();
        }
        if (!_dataUrl || _dataUrl === 'data:,') {
          errorMsg = 'Bad dataUrl: ' + _dataUrl;
        } else {
          dataUrl = _dataUrl;
        }
      })
      .catch(function(err) {
        errorMsg = err.message;
      })
      .finally(function() {
        console.log('dataUrl:\n' + dataUrl);
        sendResponse(errorMsg, dataUrl);
      });
  }

  function getFaviconMetaData(url) {
    return new Promise(resolve => {
      const img = new Image();

      img.onload = function() {
        let canvas;
        let context;
        canvas = window.document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        context = canvas.getContext('2d');
        context.drawImage(img, 0, 0);

        const imageData = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height
        );
        const origDataArray = imageData.data;
        const normalisedDataArray = new Uint8ClampedArray(origDataArray);
        const transparentDataArray = new Uint8ClampedArray(origDataArray);

        let r, g, b, a;
        let fuzzy = 0.1;
        let light = 0;
        let dark = 0;
        let maxAlpha = 0;
        let maxRgb = 0;

        for (let x = 0; x < origDataArray.length; x += 4) {
          r = origDataArray[x];
          g = origDataArray[x + 1];
          b = origDataArray[x + 2];
          a = origDataArray[x + 3];

          let localMaxRgb = Math.max(Math.max(r, g), b);
          if (localMaxRgb < 128 || a < 128) dark++;
          else light++;
          maxAlpha = Math.max(a, maxAlpha);
          maxRgb = Math.max(localMaxRgb, maxRgb);
        }

        //saftey check to make sure image is not completely transparent
        if (maxAlpha === 0) {
          getFaviconMetaData(DEFAULT_FAVICON).then(resolve);
          return;
        }

        const darkLightDiff = (light - dark) / (canvas.width * canvas.height);
        const isDark = darkLightDiff + fuzzy < 0;
        const normaliserMultiple = 1 / (maxAlpha / 255);

        for (let x = 0; x < origDataArray.length; x += 4) {
          a = origDataArray[x + 3];
          normalisedDataArray[x + 3] = parseInt(a * normaliserMultiple, 10);
        }
        for (let x = 0; x < normalisedDataArray.length; x += 4) {
          a = normalisedDataArray[x + 3];
          transparentDataArray[x + 3] = parseInt(a * 0.5, 10);
        }

        imageData.data.set(normalisedDataArray);
        context.putImageData(imageData, 0, 0);
        const normalisedDataUrl = canvas.toDataURL('image/png');

        imageData.data.set(transparentDataArray);
        context.putImageData(imageData, 0, 0);
        const transparentDataUrl = canvas.toDataURL('image/png');

        resolve({
          isDark,
          normalisedDataUrl,
          transparentDataUrl,
        });
      };
      img.src = url || DEFAULT_FAVICON;
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
    getFaviconMetaData,
  };
})();
