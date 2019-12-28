import GsTabQueue from './gsTabQueue';
import {
  log,
  warning,
  isSuspendedTab,
  isDiscardedTab,
  shouldSuspendDiscardedTabs,
  generateSuspendedUrl,
} from './gsUtils';
import { STATE_SUSPEND_REASON, setTabStatePropForTabId } from './gsTabState';
import { tabsGet } from './gsChrome';
import { getOption, DISCARD_IN_PLACE_OF_SUSPEND } from './gsStorage';
import {
  checkTabEligibilityForSuspension,
  executeTabSuspension,
} from './gsTabSuspendManager';
import { isCurrentActiveTab } from './gsTgs';

const DEFAULT_CONCURRENT_DISCARDS = 5;
const DEFAULT_DISCARD_TIMEOUT = 5 * 1000;

const QUEUE_ID = '_discardQueue';

let _discardQueue;

export const initAsPromised = () => {
  return new Promise(resolve => {
    const queueProps = {
      concurrentExecutors: DEFAULT_CONCURRENT_DISCARDS,
      jobTimeout: DEFAULT_DISCARD_TIMEOUT,
      executorFn: performDiscard,
      exceptionFn: handleDiscardException,
    };
    _discardQueue = GsTabQueue(QUEUE_ID, queueProps);
    log(QUEUE_ID, 'init successful');
    resolve();
  });
};

export const queueTabForDiscard = (tab, executionProps, processingDelay) => {
  queueTabForDiscardAsPromise(tab, executionProps, processingDelay).catch(e => {
    log(tab.id, QUEUE_ID, e);
  });
};

export const queueTabForDiscardAsPromise = (
  tab,
  executionProps,
  processingDelay
) => {
  log(tab.id, QUEUE_ID, `Queueing tab for discarding.`);
  executionProps = executionProps || {};
  return _discardQueue.queueTabAsPromise(tab, executionProps, processingDelay);
};

export const unqueueTabForDiscard = tab => {
  const removed = _discardQueue.unqueueTab(tab);
  if (removed) {
    log(tab.id, QUEUE_ID, 'Removed tab from discard queue');
  }
};

// This is called remotely by the _discardQueue
// So we must first re-fetch the tab in case it has changed
export const performDiscard = async (
  tab,
  executionProps,
  resolve,
  reject,
  requeue
) => {
  let _tab = null;
  try {
    _tab = await tabsGet(tab.id);
  } catch (error) {
    // assume tab has been discarded
  }
  if (!_tab) {
    warning(
      tab.id,
      QUEUE_ID,
      `Failed to discard tab. Tab may have already been discarded or removed.`
    );
    resolve(false);
    return;
  }
  tab = _tab;

  if (isSuspendedTab(tab) && tab.status === 'loading') {
    log(tab.id, QUEUE_ID, 'Tab is still loading');
    requeue();
    return;
  }
  if (isCurrentActiveTab(tab)) {
    const discardInPlaceOfSuspend = getOption(DISCARD_IN_PLACE_OF_SUSPEND);
    if (!discardInPlaceOfSuspend) {
      log(tab.id, QUEUE_ID, 'Tab is active. Aborting discard.');
      resolve(false);
      return;
    }
  }
  if (isDiscardedTab(tab)) {
    log(tab.id, QUEUE_ID, 'Tab already discarded');
    resolve(false);
    return;
  }
  log(tab.id, QUEUE_ID, 'Forcing discarding of tab.');
  chrome.tabs.discard(tab.id, () => {
    if (chrome.runtime.lastError) {
      warning(tab.id, QUEUE_ID, chrome.runtime.lastError);
      resolve(false);
    } else {
      resolve(true);
    }
  });
};

function handleDiscardException(tab, executionProps, exceptionType, resolve) {
  warning(tab.id, QUEUE_ID, `Failed to discard tab: ${exceptionType}`);
  resolve(false);
}

export const handleDiscardedUnsuspendedTab = async tab => {
  if (
    shouldSuspendDiscardedTabs() &&
    checkTabEligibilityForSuspension(tab, 3)
  ) {
    setTabStatePropForTabId(tab.id, STATE_SUSPEND_REASON, 3);
    const suspendedUrl = generateSuspendedUrl(tab.url, tab.title, 0);
    log(tab.id, QUEUE_ID, 'Suspending discarded unsuspended tab');

    // Note: This bypasses the suspension tab queue and also prevents screenshots from being taken
    await executeTabSuspension(tab, suspendedUrl);
    return;
  }
};
