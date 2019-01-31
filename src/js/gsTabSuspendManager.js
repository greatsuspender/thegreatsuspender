/*global html2canvas, domtoimage, tgs, gsFavicon, gsMessages, gsStorage, gsUtils, gsChrome, gsIndexedDb, gsTabDiscardManager, GsTabQueue */
// eslint-disable-next-line no-unused-vars
var gsTabSuspendManager = (function() {
  'use strict';

  const DEFAULT_CONCURRENT_SUSPENSIONS = 3;
  const DEFAULT_SUSPENSION_TIMEOUT = 60 * 1000;

  let _suspensionQueue;

  function initAsPromised() {
    return new Promise(async function(resolve) {
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
      _suspensionQueue = GsTabQueue('suspensionQueue', queueProps);
      gsUtils.log('gsTabSuspendManager', 'init successful');
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
    return _suspensionQueue.queueTabAsPromise(tab, { forceLevel });
  }

  function unqueueTabForSuspension(tab) {
    const removed = _suspensionQueue.unqueueTab(tab);
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
    let screenCaptureMode = gsStorage.getOption(gsStorage.SCREEN_CAPTURE);
    const discardInPlaceOfSuspend = gsStorage.getOption(
      gsStorage.DISCARD_IN_PLACE_OF_SUSPEND
    );
    if (discardInPlaceOfSuspend) {
      screenCaptureMode = '0';
    }

    let tabInfo = await getContentScriptTabInfo(tab);
    // If tabInfo is null this is usually due to tab loading, being discarded or 'parked' on chrome restart
    if (!tabInfo) {
      // If we need to make a screen capture and tab is not responding then reload it
      // TODO: This doesn't actually seem to work
      // Tabs that have just been reloaded usually fail to run the screen capture script :(
      if (
        tab.status !== 'loading' &&
        screenCaptureMode !== '0' &&
        !executionProps.reloaded
      ) {
        gsUtils.log(
          tab.id,
          'Tab is not responding. Will reload for screen capture.'
        );
        tgs.setTabStatePropForTabId(
          tab.id,
          tgs.STATE_SUSPEND_ON_RELOAD_URL,
          tab.url
        );
        await gsChrome.tabsUpdate(tab.id, { url: tab.url });
        // allow up to 30 seconds for tab to reload and trigger its subsequent suspension request
        // note that this will not reset the DEFAULT_SUSPENSION_TIMEOUT of 60 seconds
        requeue(30000, { reloaded: true });
        return;
      }
      tabInfo = {
        status: 'loading',
        scrollPos: '0',
      };
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

    // Hack. Save handle to resolve function so we can call it later
    executionProps.resolveFn = resolve;
    requestGeneratePreviewImage(tab); //async
    gsUtils.log(tab.id, 'Preview generation script started successfully.');
    // resumeQueuedTabSuspension is called on the 'savePreviewData' message response
    // this will refetch the queued tabDetails and call executionProps.resolveFn(true)
  }

  function handlePreviewImageResponse(tab, previewUrl, errorMsg) {
    if (previewUrl) {
      gsIndexedDb
        .addPreviewImage(tab.url, previewUrl)
        .then(() => resumeQueuedTabSuspension(tab)); //async. unhandled promise.
    } else {
      gsUtils.warning(tab.id, 'savePreviewData reported an error: ', errorMsg);
      resumeQueuedTabSuspension(tab); //async. unhandled promise.
    }
  }

  async function resumeQueuedTabSuspension(tab) {
    const queuedTabDetails = _suspensionQueue.getQueuedTabDetails(tab);
    if (!queuedTabDetails) {
      gsUtils.log(
        tab.id,
        'Tab missing from suspensionQueue. Assuming suspension cancelled for this tab.'
      );
      return;
    }

    const suspensionForceLevel = queuedTabDetails.executionProps.forceLevel;
    if (!checkTabEligibilityForSuspension(tab, suspensionForceLevel)) {
      gsUtils.log(
        tab.id,
        'Tab is no longer eligible for suspension. Removing tab from suspensionQueue.'
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
    if (exceptionType === _suspensionQueue.EXCEPTION_TIMEOUT) {
      gsUtils.log(
        tab.id,
        `Tab took more than ${
          _suspensionQueue.getQueueProperties().jobTimeout
        }ms to suspend. Will force suspension.`
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
        tgs.clearAutoSuspendTimerForTabId(tab.id);
        gsTabDiscardManager.queueTabForDiscard(tab);
        resolve();
        return;
      }

      if (!suspendedUrl) {
        gsUtils.log(tab.id, 'executionProps.suspendedUrl not set!');
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
    if (gsUtils.isSuspendedTab(tab, true)) {
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
      if (gsUtils.isSuspendedTab(tab, true) || gsUtils.isSpecialTab(tab)) {
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
    const tabProperties = {
      date: new Date(),
      title: tab.title,
      url: tab.url,
      favIconUrl: tab.favIconUrl,
      pinned: tab.pinned,
      index: tab.index,
      windowId: tab.windowId,
    };
    await gsIndexedDb.addSuspendedTabInfo(tabProperties);

    const faviconMeta = await gsFavicon.buildFaviconMetaFromChromeFaviconCache(
      tab.url
    );
    if (faviconMeta) {
      gsFavicon.saveFaviconMetaDataToCache(tab.url, faviconMeta);
    }
  }

  function requestGeneratePreviewImage(tab) {
    // Will not implement this for now as it does not actually capture the whole
    // screen, just the visible area
    // NOTE: It also requires the <all_urls> manifest permission
    // if (tab.active) {
    //   chrome.tabs.captureVisibleTab(
    //     tab.windowId,
    //     { format: 'png' },
    //     dataUrl => {
    //       handlePreviewImageResponse(tab, dataUrl, chrome.runtime.lastError);
    //     }
    //   );
    //   return;
    // }

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
    gsMessages.executeScriptOnTab(tab.id, screenCaptureLib, error => {
      if (error) {
        handlePreviewImageResponse(tab, null, 'Failed to executeScriptOnTab');
        return;
      }
      gsMessages.executeCodeOnTab(
        tab.id,
        `(${generatePreviewImageCanvasViaContentScript})("${screenCaptureMode}", ${forceScreenCapture}, ${useAlternateScreenCaptureLib});`,
        error => {
          if (error) {
            handlePreviewImageResponse(
              tab,
              null,
              'Failed to executeCodeOnTab: generatePreviewImgContentScript'
            );
            return;
          }
        }
      );
    });
  }

  // NOTE: This function below is run within the content script scope
  // Therefore it must be self contained and not refer to any external functions
  // eslint-disable-next-line no-unused-vars
  async function generatePreviewImageCanvasViaContentScript(
    screenCaptureMode,
    forceScreenCapture,
    useAlternateScreenCaptureLib
  ) {
    const MAX_CANVAS_HEIGHT = forceScreenCapture ? 10000 : 5000;
    const IMAGE_TYPE = 'image/webp';
    const IMAGE_QUALITY = forceScreenCapture ? 0.92 : 0.5;

    let height = 0;
    let width = 0;

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

    let generateCanvas;
    if (useAlternateScreenCaptureLib) {
      // console.log('Generating via dom-to-image..');
      generateCanvas = () => {
        return domtoimage.toCanvas(document.body, {}).then(canvas => {
          const croppedCanvas = document.createElement('canvas');
          const context = croppedCanvas.getContext('2d');
          croppedCanvas.width = width;
          croppedCanvas.height = height;
          context.drawImage(canvas, 0, 0);
          return croppedCanvas;
        });
      };
    } else {
      // console.log('Generating via html2canvas..');
      generateCanvas = () => {
        return html2canvas(document.body, {
          height: height,
          width: width,
          logging: false,
          imageTimeout: 10000,
          removeContainer: false,
          async: true,
        });
      };
    }

    const generateDataUrl = canvas => {
      let dataUrl = canvas.toDataURL(IMAGE_TYPE, IMAGE_QUALITY);
      if (!dataUrl || dataUrl === 'data:,') {
        dataUrl = canvas.toDataURL();
      }
      if (dataUrl === 'data:,') {
        dataUrl = null;
      }
      return dataUrl;
    };

    let dataUrl;
    let errorMsg;
    try {
      const canvas = await generateCanvas();
      // console.log('generating dataUrl..');
      dataUrl = generateDataUrl(canvas);
    } catch (err) {
      errorMsg = err.message;
    }
    if (!dataUrl && !errorMsg) {
      errorMsg = 'Failed to generate dataUrl';
    }
    // console.log('saving previewData..');
    chrome.runtime.sendMessage({
      action: 'savePreviewData',
      previewUrl: dataUrl,
      errorMsg: errorMsg,
    });
  }

  return {
    initAsPromised,
    queueTabForSuspension,
    queueTabForSuspensionAsPromise,
    unqueueTabForSuspension,
    handlePreviewImageResponse,
    resumeQueuedTabSuspension,
    saveSuspendData,
    checkTabEligibilityForSuspension,
    forceTabSuspension,
  };
})();
