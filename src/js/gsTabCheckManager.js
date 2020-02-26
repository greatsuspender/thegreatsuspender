import GsTabQueue from './gsTabQueue';
import { reinjectContentScriptOnTab } from './helpers/contentScripts';
import {
  log,
  warning,
  isSuspendedTab,
  isNormalTab,
  isDiscardedTab,
  getOriginalUrl,
  hasProperty,
  STATUS_UNKNOWN,
  STATUS_DISCARDED,
  STATUS_SUSPENDED,
} from './gsUtils';
import {
  isInitialising,
  isFileUrlsAccessAllowed,
  getSessionId,
} from './gsSession';
import { tabsGet, tabsQuery, tabsReload, tabsUpdate } from './gsChrome';
import { getOption } from './gsStorage';
import { initTab } from './gsSuspendedTab';
import {
  // STATE_DISABLE_UNSUSPEND_ON_RELOAD,
  setTabStatePropForTabId,
} from './gsTabState';
import { executeScriptOnTab } from './gsMessages';
import { sendRequestInfoToContentScript } from './helpers/contentScripts';
import { getInternalViewByTabId } from './gsViews';
import { isCurrentActiveTab } from './gsTgs';

const DEFAULT_CONCURRENT_TAB_CHECKS = 3;
const DEFAULT_TAB_CHECK_TIMEOUT = 60 * 1000;
const DEFAULT_TAB_CHECK_PROCESSING_DELAY = 500;
const DEFAULT_TAB_CHECK_REQUEUE_DELAY = 3 * 1000;

const QUEUE_ID = 'checkQueue';

let _defaultTabTitle;
let _tabCheckQueue;

// NOTE: This mainly checks suspended tabs
// For unsuspended tabs, there is no guarantee that the content script will
// be responsive, but seeing as the timer is kept by the background script, it
// doesn't really matter.
// However, when a tab gains focus, there is a check to make sure the content
// script is responsive, as we then need to rely on the form input and scroll behaviour.
export const initAsPromised = () => {
  return new Promise(resolve => {
    const queueProps = {
      concurrentExecutors: DEFAULT_CONCURRENT_TAB_CHECKS,
      jobTimeout: DEFAULT_TAB_CHECK_TIMEOUT,
      processingDelay: DEFAULT_TAB_CHECK_PROCESSING_DELAY,
      executorFn: handleTabCheck,
      exceptionFn: handleTabCheckException,
    };
    _defaultTabTitle = chrome.i18n.getMessage('html_suspended_title');
    _tabCheckQueue = GsTabQueue(QUEUE_ID, queueProps);
    log(QUEUE_ID, 'init successful');
    resolve();
  });
};

// Suspended tabs that exist or are created before the end of extension
// initialisation will need to be initialised by this startup script
export const performInitialisationTabChecks = async tabs => {
  // Temporarily change jobTimeout while we are starting up
  const initJobTimeout = Math.max(
    tabs.length * 1000,
    DEFAULT_TAB_CHECK_TIMEOUT
  );
  const initProcessingDelay = DEFAULT_TAB_CHECK_PROCESSING_DELAY;
  const concurrentExecutors = DEFAULT_CONCURRENT_TAB_CHECKS;
  updateQueueProps(initJobTimeout, initProcessingDelay, concurrentExecutors);

  const tabCheckPromises = [];
  for (const tab of tabs) {
    if (!isSuspendedTab(tab)) {
      continue;
    }
    tabCheckPromises
      .push
      // Set to refetch immediately when being processed on the queue
      // From experience, even if a tab status is 'complete' now, it
      // may actually switch to 'loading' in a few seconds even though a
      // tab reload has not be performed

      //TODO: Reenable this check
      // queueTabCheckAsPromise(tab, { resuspend: true }, 1000)
      ();
  }

  const tabUpdatedListener = getTabUpdatedListener();
  chrome.tabs.onUpdated.addListener(tabUpdatedListener);

  const results = await Promise.all(tabCheckPromises);

  chrome.tabs.onUpdated.removeListener(tabUpdatedListener);

  // Revert timeout
  updateQueueProps(
    DEFAULT_TAB_CHECK_TIMEOUT,
    DEFAULT_TAB_CHECK_PROCESSING_DELAY,
    DEFAULT_CONCURRENT_TAB_CHECKS
  );

  return results;
};

export const getTabUpdatedListener = () => {
  return (tabId, changeInfo, _tab) => {
    if (
      !isSuspendedTab(_tab) ||
      !changeInfo ||
      !hasProperty(changeInfo, 'status') ||
      changeInfo.status !== 'complete'
    ) {
      return;
    }
    log(_tab.id, 'suspended tab loaded. status === complete');
    const tabQueueDetails = getQueuedTabCheckDetails(_tab);
    if (tabQueueDetails) {
      // If tab is in check queue, then force it to continue processing immediately
      // This allows us to prevent a timeout -> fetch tab cycle
      tabQueueDetails.tab = _tab;
      queueTabCheck(_tab, { refetchTab: false }, 0);
    }
  };
};

export const updateQueueProps = (
  jobTimeout,
  processingDelay,
  concurrentExecutors
) => {
  log(
    QUEUE_ID,
    `Setting _tabCheckQueue props. jobTimeout: ${jobTimeout}. processingDelay: ${processingDelay}. concurrentExecutors: ${concurrentExecutors}`
  );
  _tabCheckQueue.setQueueProperties({
    jobTimeout,
    processingDelay,
    concurrentExecutors,
  });
};

export const queueTabCheck = (tab, executionProps, processingDelay) => {
  queueTabCheckAsPromise(tab, executionProps, processingDelay).catch(e => {
    log(tab.id, QUEUE_ID, e);
  });
};

export const queueTabCheckAsPromise = (
  tab,
  executionProps,
  processingDelay
) => {
  log(tab.id, QUEUE_ID, `Queueing tab for responsiveness check.`);
  executionProps = executionProps || {};
  return _tabCheckQueue.queueTabAsPromise(tab, executionProps, processingDelay);
};

export const unqueueTabCheck = tab => {
  const removed = _tabCheckQueue.unqueueTab(tab);
  if (removed) {
    log(tab.id, QUEUE_ID, 'Removed tab from check queue.');
  }
};

export const getQueuedTabCheckDetails = tab => {
  return _tabCheckQueue.getQueuedTabDetails(tab);
};

export const handleTabCheckException = (
  tab,
  executionProps,
  exceptionType,
  resolve
) => {
  warning(tab.id, QUEUE_ID, `Failed to initialise tab: ${exceptionType}`);
  resolve(false);
};

export const handleTabCheck = (
  tab,
  executionProps,
  resolve,
  reject,
  requeue
) => {
  if (isSuspendedTab(tab)) {
    checkSuspendedTab(tab, executionProps, resolve, reject, requeue);
  } else if (isNormalTab(tab)) {
    checkNormalTab(tab, executionProps, resolve, reject, requeue);
  }
};

export const getUpdatedTab = async tab => {
  const _tab = await tabsGet(tab.id);
  if (!_tab) {
    warning(
      tab.id,
      QUEUE_ID,
      `Failed to initialize tab. Tab may have been discarded or removed.`
    );
    // If we are still initialising, then check for potential discarded tab matches
    if (isInitialising()) {
      await queueTabCheckForPotentiallyDiscardedTabs(tab);
    }
  }
  return _tab;
};

export const queueTabCheckForPotentiallyDiscardedTabs = async tab => {
  // NOTE: For some reason querying by url doesn't work here??
  // TODO: Report chrome bug
  let tabs = await tabsQuery({
    discarded: true,
    windowId: tab.windowId,
  });
  tabs = tabs.filter(o => o.url === tab.url);
  log(tab.id, QUEUE_ID, 'Searching for discarded tab matching tab: ', tab);
  const matchingTab = tabs.find(o => o.index === tab.index);
  if (matchingTab) {
    tabs = [matchingTab];
  }
  for (const tab of tabs) {
    await resuspendSuspendedTab(tab);
    queueTabCheck(tab, { refetchTab: true }, 2000);
  }
};

async function checkSuspendedTab(
  tab,
  executionProps,
  resolve,
  reject,
  requeue
) {
  if (executionProps.resuspend && !executionProps.resuspended) {
    await resuspendSuspendedTab(tab);
    requeue(DEFAULT_TAB_CHECK_REQUEUE_DELAY, {
      resuspended: true,
    });
    return;
  }

  if (executionProps.refetchTab) {
    log(tab.id, QUEUE_ID, 'Tab refetch requested. Getting updated tab..');
    tab = await getUpdatedTab(tab);
    if (!tab) {
      resolve(STATUS_UNKNOWN);
      return;
    }
    log(tab.id, QUEUE_ID, 'Updated tab: ', tab);

    // Ensure tab is still suspended
    if (!isSuspendedTab(tab)) {
      log(tab.id, QUEUE_ID, 'Tab is no longer suspended. Aborting check.');
      resolve(STATUS_UNKNOWN);
      return;
    }

    // If tab has a state of loading, then requeue for checking later
    if (tab.status === 'loading') {
      log(tab.id, QUEUE_ID, 'Tab is still loading');
      requeue(DEFAULT_TAB_CHECK_REQUEUE_DELAY, { refetchTab: true });
      return;
    }
  }

  // Make sure tab is registered as a 'view' of the extension
  const suspendedView = getInternalViewByTabId(tab.id);
  if (!suspendedView) {
    log(
      tab.id,
      QUEUE_ID,
      'Could not find an internal view for suspended tab.',
      tab
    );
    if (!executionProps.resuspended) {
      const resuspendOk = await resuspendSuspendedTab(tab);
      if (resuspendOk) {
        requeue(DEFAULT_TAB_CHECK_REQUEUE_DELAY, {
          resuspended: true,
          refetchTab: true,
        });
        return;
      }
      warning(tab.id, QUEUE_ID, 'Failed to resuspend tab');
      resolve(STATUS_UNKNOWN);
      return;
    }
    // Queue a refresh as tab may no longer exist
    requeue(DEFAULT_TAB_CHECK_REQUEUE_DELAY, { refetchTab: true });
    return;
  }

  // If tab is a file:// tab and file is blocked then unsuspend tab
  if (!isFileUrlsAccessAllowed()) {
    const originalUrl = getOriginalUrl(tab.url);
    if (originalUrl && originalUrl.indexOf('file') === 0) {
      log(tab.id, QUEUE_ID, 'Unsuspending blocked local file tab.');
      await unsuspendSuspendedTab(tab);
      requeue(DEFAULT_TAB_CHECK_REQUEUE_DELAY, { refetchTab: true });
      return;
    }
  }

  const tabSessionOk = suspendedView.document.sessionId === getSessionId();
  const tabBasicsOk = ensureSuspendedTabTitleAndFaviconSet(tab);
  const tabVisibleOk = ensureSuspendedTabVisible(suspendedView);
  const tabChecksOk = tabSessionOk && tabBasicsOk && tabVisibleOk;

  let reinitialised = false;
  if (!tabChecksOk) {
    const tabQueueDetails = _tabCheckQueue.getQueuedTabDetails(tab);
    if (!tabQueueDetails) {
      resolve(STATUS_UNKNOWN);
      return;
    }
    try {
      log(tab.id, QUEUE_ID, 'Reinitialising suspendedTab: ', tab);
      // If we know that we will discard tab, then just perform a quick init
      await initTab(tab, suspendedView);
      reinitialised = true;
    } catch (e) {
      log(
        tab.id,
        QUEUE_ID,
        'Failed to reinitialise suspendedTab. Will requeue with refetching.',
        e
      );
      requeue(DEFAULT_TAB_CHECK_REQUEUE_DELAY, { refetchTab: true });
      return;
    }
  }
  resolve(STATUS_SUSPENDED);
}

export const resuspendSuspendedTab = async tab => {
  log(tab.id, QUEUE_ID, 'Resuspending unresponsive suspended tab.');
  const suspendedView = getInternalViewByTabId(tab.id);
  if (suspendedView) {
    // TODO: Reenable this?
    // setTabStatePropForTabId(tab.id, STATE_DISABLE_UNSUSPEND_ON_RELOAD, true);
  }
  const reloadOk = await tabsReload(tab.id);
  return reloadOk;
};

export const unsuspendSuspendedTab = async tab => {
  const originalUrl = getOriginalUrl(tab.url);
  await tabsUpdate(tab.id, { url: originalUrl });
};

export const ensureSuspendedTabVisible = tabView => {
  if (!tabView) {
    return false;
  }
  const bodyEl = tabView.document.getElementsByTagName('body')[0];
  if (!bodyEl) {
    return false;
  }
  return !bodyEl.classList.contains('hide-initially');
};

export const ensureSuspendedTabTitleAndFaviconSet = tab => {
  if (!tab.favIconUrl || tab.favIconUrl.indexOf('data:image') !== 0) {
    log(tab.id, QUEUE_ID, 'Tab favicon not set or not dataUrl.', tab);
    return false;
  }
  if (!tab.title || tab.title === _defaultTabTitle) {
    log(tab.id, QUEUE_ID, 'Tab title not set', tab);
    return false;
  }
  return true;
};

export const checkNormalTab = async (
  tab,
  executionProps,
  resolve,
  reject,
  requeue
) => {
  if (executionProps.refetchTab) {
    log(tab.id, QUEUE_ID, 'Tab refetch requested. Getting updated tab..');
    tab = await getUpdatedTab(tab);
    if (!tab) {
      resolve(STATUS_UNKNOWN);
      return;
    }
    log(tab.id, QUEUE_ID, 'Updated tab: ', tab);

    // Ensure tab is not suspended
    if (isSuspendedTab(tab)) {
      log(tab.id, QUEUE_ID, 'Tab is suspended. Aborting check.');
      resolve(STATUS_SUSPENDED);
      return;
    }

    // If tab has a state of loading, then requeue for checking later
    if (tab.status === 'loading') {
      log(tab.id, QUEUE_ID, 'Tab is still loading');
      requeue(DEFAULT_TAB_CHECK_REQUEUE_DELAY, { refetchTab: true });
      return;
    }
  }

  if (isDiscardedTab(tab)) {
    if (tab.active) {
      log(
        tab.id,
        QUEUE_ID,
        'Tab is discarded but active. Will wait for auto reload.'
      );
      requeue(500, { refetchTab: true });
    } else {
      log(tab.id, QUEUE_ID, 'Tab is discarded. Will reload.');
      await tabsReload(tab.id);
      requeue(DEFAULT_TAB_CHECK_REQUEUE_DELAY, { refetchTab: true });
    }
    return;
  }

  let tabInfo = await sendRequestInfoToContentScript(tab.id);

  if (tabInfo) {
    resolve(tabInfo.status);
    return;
  }

  const queuedTabDetails = _tabCheckQueue.getQueuedTabDetails(tab);
  if (!queuedTabDetails) {
    log(tab.id, QUEUE_ID, 'Tab missing from suspensionQueue?');
    resolve(STATUS_UNKNOWN);
    return;
  }

  if (tab.active && queuedTabDetails.requeues === 0) {
    log(
      tab.id,
      QUEUE_ID,
      'Tab is not responding but active. Will wait for potential auto reload.'
    );
    requeue(500, { refetchTab: false });
    return;
  }

  tabInfo = await reinjectContentScriptOnTab(tab);
  if (tabInfo) {
    resolve(tabInfo.status);
  } else {
    resolve(STATUS_UNKNOWN);
  }
};
