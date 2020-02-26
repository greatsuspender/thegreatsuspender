import html2canvas from './html2canvas';
import domtoimage from './dom-to-image';
import GsTabQueue from './gsTabQueue';
import { suspendTab } from './actions/suspendTab';
import {
  log,
  warning,
  isSuspendedTab,
  getOriginalUrl,
  isSpecialTab,
  isProtectedActiveTab,
  isProtectedPinnedTab,
  isProtectedAudibleTab,
  checkWhiteList,
  STATUS_FORMINPUT,
  STATUS_TEMPWHITELIST,
} from './gsUtils';
import { tabsGet, tabsUpdate } from './gsChrome';
import { clearAutoSuspendTimerForTabId } from './gsTabState';
import {
  getStatusForTabId,
  setScrollPosForTabId,
  setStatusForTabId,
} from './helpers/tabStates';
import {
  getOption,
  SCREEN_CAPTURE_FORCE,
  SCREEN_CAPTURE,
  IGNORE_WHEN_OFFLINE,
  IGNORE_WHEN_CHARGING,
  SUSPEND_TIME,
  USE_ALT_SCREEN_CAPTURE_LIB,
} from './gsStorage';
import { unqueueTabCheck } from './gsTabCheckManager';
import { executeScriptOnTab, executeCodeOnTab } from './gsMessages';
import { sendRequestInfoToContentScript } from './helpers/contentScripts';
import {
  fetchTabInfo,
  addPreviewImage,
  addSuspendedTabInfo,
} from './gsIndexedDb';
import { isCharging } from './gsTgs';

const DEFAULT_CONCURRENT_SUSPENSIONS = 3;
const DEFAULT_SUSPENSION_TIMEOUT = 60 * 1000;

const QUEUE_ID = 'suspendQueue';

let _suspensionQueue;

export const initAsPromised = () => {
  return new Promise(function(resolve) {
    const screenCaptureMode = getOption(SCREEN_CAPTURE);
    const forceScreenCapture = getOption(SCREEN_CAPTURE_FORCE);
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
    log(QUEUE_ID, 'init successful');
    resolve();
  });
};

export const queueTabForSuspension = (tab, forceLevel) => {
  setStatusForTabId(tab.id, 'suspending');
  queueTabForSuspensionAsPromise(tab, forceLevel).catch(e => {
    log(tab.id, QUEUE_ID, e);
  });
};

const queueTabForSuspensionAsPromise = (tab, forceLevel) => {
  if (typeof tab === 'undefined') return Promise.resolve();

  if (!checkTabEligibilityForSuspension(tab, forceLevel)) {
    log(tab.id, QUEUE_ID, 'Tab not eligible for suspension.');
    return Promise.resolve();
  }

  log(tab.id, QUEUE_ID, 'Queueing tab for suspension.');
  return _suspensionQueue.queueTabAsPromise(tab, { forceLevel });
};

export const unqueueTabForSuspension = tab => {
  const removed = _suspensionQueue.unqueueTab(tab);
  if (removed) {
    log(tab.id, QUEUE_ID, 'Removed tab from suspension queue.');
  }
};

async function performSuspension(
  tab,
  executionProps,
  resolve,
  reject,
  requeue
) {
  // Check tab is still in need of suspension
  const tabStatus = getStatusForTabId(tab.id);
  if (tabStatus !== 'suspending') {
    log(
      tab.id,
      QUEUE_ID,
      `Tab has status of ${status}. Will ignore suspension request`
    );
    resolve(false);
    return;
  }

  // Check tab is not already suspended
  if (isSuspendedTab(tab)) {
    log(
      tab.id,
      QUEUE_ID,
      'Tab is already suspended. Will ignore tab suspension request'
    );
    resolve(false);
    return;
  }

  // Get most recent tab state
  const _tab = await tabsGet(tab.id);
  if (!_tab) {
    log(
      tab.id,
      QUEUE_ID,
      'Could not find tab with id. Will ignore suspension request'
    );
    resolve(false);
    return;
  }
  tab = _tab;

  // If tab is in loading state, try to suspend early if possible
  // Note: doing so will bypass a few checks below. Namely:
  // - Any temporary pause flag that has been set up on the tab
  // - It may lose any scrollPos value
  // Although if the tab is still loading then pause and scroll pos should
  // not be set?
  // Do not bypass loading state if screen capture is required
  const screenCaptureMode = getOption(SCREEN_CAPTURE);
  if (tab.status === 'loading') {
    if (screenCaptureMode === '0') {
      log(tab.id, QUEUE_ID, 'Interrupting tab loading to resuspend tab');
      const success = await suspendTab(tab);
      resolve(success);
    } else {
      requeue(3000);
    }
    return;
  }

  let tabInfo = await sendRequestInfoToContentScript(tab.id);
  tabInfo = tabInfo || {
    status: 'unknown',
    scrollPos: '0',
  };

  const isEligible = checkContentScriptEligibilityForSuspension(
    tabInfo.status,
    executionProps.forceLevel
  );
  if (!isEligible) {
    log(
      tab.id,
      QUEUE_ID,
      `Content script status of ${tabInfo.status} not eligible for suspension. Removing tab from suspensionQueue.`
    );
    resolve(false);
    return;
  }

  // Set scrollPos in tabState
  setScrollPosForTabId(tab.id, tabInfo.scrollPos);

  if (screenCaptureMode === '0') {
    const success = await suspendTab(tab);
    resolve(success);
    return;
  }

  // Hack. Save handle to resolve function so we can call it later
  executionProps.resolveFn = resolve;
  requestGeneratePreviewImage(tab); //async
  log(tab.id, QUEUE_ID, 'Preview generation script started successfully.');
  // handlePreviewImageResponse is called on the 'savePreviewData' message response
  // this will refetch the queued tabDetails and call executionProps.resolveFn(true)
}

export const handlePreviewImageResponse = async (tab, previewUrl, errorMsg) => {
  const queuedTabDetails = getQueuedTabDetails(tab);
  if (!queuedTabDetails) {
    log(
      tab.id,
      QUEUE_ID,
      'Tab missing from suspensionQueue. Assuming suspension cancelled for this tab.'
    );
    return;
  }

  const suspensionForceLevel = queuedTabDetails.executionProps.forceLevel;
  if (!checkTabEligibilityForSuspension(tab, suspensionForceLevel)) {
    log(
      tab.id,
      QUEUE_ID,
      'Tab is no longer eligible for suspension. Removing tab from suspensionQueue.'
    );
    return;
  }

  if (!previewUrl) {
    warning(tab.id, QUEUE_ID, 'savePreviewData reported an error: ', errorMsg);
  } else {
    await addPreviewImage(tab.url, previewUrl);
  }

  const success = await suspendTab(tab);
  queuedTabDetails.executionProps.resolveFn(success);
};

export const getQueuedTabDetails = tab => {
  return _suspensionQueue.getQueuedTabDetails(tab);
};

async function handleSuspensionException(
  tab,
  executionProps,
  exceptionType,
  resolve
) {
  if (exceptionType === _suspensionQueue.EXCEPTION_TIMEOUT) {
    log(
      tab.id,
      QUEUE_ID,
      `Tab took more than ${
        _suspensionQueue.getQueueProperties().jobTimeout
      }ms to suspend. Will force suspension.`
    );
    const success = await suspendTab(tab);
    resolve(success);
  } else {
    warning(tab.id, QUEUE_ID, `Failed to suspend tab: ${exceptionType}`);
    resolve(false);
  }
}

// forceLevel indicates which users preferences to respect when attempting to suspend the tab
// 1: Suspend if at all possible
// 2: Respect whitelist, temporary whitelist, form input, pinned tabs, audible preferences, and exclude current active tab
// 3: Same as above (2), plus also respect internet connectivity, running on battery, and time to suspend=never preferences.
export const checkTabEligibilityForSuspension = (tab, forceLevel) => {
  if (forceLevel >= 1) {
    // if (isSuspendedTab(tab) || isSpecialTab(tab)) {
    // actually allow suspended tabs to attempt suspension in case they are
    // in the process of being reloaded and we have changed our mind and
    // want to suspend them again.
    if (isSpecialTab(tab)) {
      return false;
    }
  }
  if (forceLevel >= 2) {
    if (
      isProtectedActiveTab(tab) ||
      checkWhiteList(tab.url) ||
      isProtectedPinnedTab(tab) ||
      isProtectedAudibleTab(tab)
    ) {
      return false;
    }
  }
  if (forceLevel >= 3) {
    if (getOption(IGNORE_WHEN_OFFLINE) && !navigator.onLine) {
      return false;
    }
    if (getOption(IGNORE_WHEN_CHARGING) && isCharging()) {
      return false;
    }
    if (getOption(SUSPEND_TIME) === '0') {
      return false;
    }
  }
  return true;
};

function checkContentScriptEligibilityForSuspension(
  contentScriptStatus,
  forceLevel
) {
  if (
    forceLevel >= 2 &&
    (contentScriptStatus === STATUS_FORMINPUT ||
      contentScriptStatus === STATUS_TEMPWHITELIST)
  ) {
    return false;
  }
  return true;
}

export const requestGeneratePreviewImage = tab => {
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
  //   ); //async. unhandled promise.
  //   return;
  // }

  const screenCaptureMode = getOption(SCREEN_CAPTURE);
  const forceScreenCapture = getOption(SCREEN_CAPTURE_FORCE);
  const useAlternateScreenCaptureLib = getOption(USE_ALT_SCREEN_CAPTURE_LIB);
  const screenCaptureLib = useAlternateScreenCaptureLib
    ? 'js/dom-to-image.js'
    : 'js/html2canvas.min.js';
  log(tab.id, QUEUE_ID, `Injecting ${screenCaptureLib} into content script`);
  executeScriptOnTab(tab.id, screenCaptureLib, error => {
    if (error) {
      handlePreviewImageResponse(tab, null, 'Failed to executeScriptOnTab'); //async. unhandled promise.
      return;
    }
    executeCodeOnTab(
      tab.id,
      `(${generatePreviewImageCanvasViaContentScript})("${screenCaptureMode}", ${forceScreenCapture}, ${useAlternateScreenCaptureLib});`,
      error => {
        if (error) {
          handlePreviewImageResponse(
            tab,
            null,
            'Failed to executeCodeOnTab: generatePreviewImgContentScript'
          ); //async. unhandled promise.
          return;
        }
      }
    );
  });
};

// NOTE: This function below is run within the content script scope
// Therefore it must be self contained and not refer to any external functions
// such as references to gsUtils etc.
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

  const isCanvasVisible = canvas => {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < imageData.data.length; i += 4) {
      const isTransparent = imageData.data[i + 3] === 0;
      const isWhite =
        imageData.data[i] === 255 &&
        imageData.data[i + 1] === 255 &&
        imageData.data[i + 2] === 255;
      if (!isTransparent && !isWhite) {
        return true;
      }
    }
    return false;
  };

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
    if (!isCanvasVisible(canvas)) {
      errorMsg = 'Canvas contains no visible pixels';
    } else {
      dataUrl = generateDataUrl(canvas);
    }
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
