/*global chrome, localStorage, tgs, gsUtils, gsChrome, GsTabQueue, gsTabSuspendManager */
// eslint-disable-next-line no-unused-vars
var gsTabDiscardManager = (function() {
  'use strict';

  const DEFAULT_CONCURRENT_DISCARDS = 5;
  const DEFAULT_DISCARD_TIMEOUT = 5 * 1000;

  const QUEUE_ID = 'discardQueue';

  let discardQueue;

  function initAsPromised() {
    return new Promise(resolve => {
      const queueProps = {
        concurrentExecutors: DEFAULT_CONCURRENT_DISCARDS,
        jobTimeout: DEFAULT_DISCARD_TIMEOUT,
        executorFn: performDiscard,
        exceptionFn: handleDiscardException,
      };
      discardQueue = GsTabQueue(QUEUE_ID, queueProps);
      gsUtils.log('gsTabDiscardManager', 'init successful');
      resolve();
    });
  }

  // Discard all suspended tabs currently open during extension initialisation
  async function performInitialisationTabDiscards(tabs) {
    const tabDiscardPromises = [];
    for (const tab of tabs) {
      if (!gsUtils.isSuspendedTab(tab) || gsUtils.isDiscardedTab(tab)) {
        continue;
      }
      tabDiscardPromises.push(queueTabForDiscardAsPromise(tab, {}, 0));
    }
    const results = await Promise.all(tabDiscardPromises);
    return results;
  }

  function queueTabForDiscard(tab, executionProps, processingDelay) {
    queueTabForDiscardAsPromise(tab, executionProps, processingDelay).catch(
      e => {
        gsUtils.log(tab.id, QUEUE_ID, e);
      }
    );
  }

  function queueTabForDiscardAsPromise(tab, executionProps, processingDelay) {
    gsUtils.log(tab.id, QUEUE_ID, `Queuing tab for discarding.`);
    executionProps = executionProps || {};
    return discardQueue.queueTabAsPromise(tab, executionProps, processingDelay);
  }

  function unqueueTabForDiscard(tab) {
    const removed = discardQueue.unqueueTab(tab);
    if (removed) {
      gsUtils.log(tab.id, QUEUE_ID, `Removed tab from discard queue.`);
    }
  }

  // This is called remotely by the discardQueue
  // So we must first re-fetch the tab in case it has changed
  async function performDiscard(tab, executionProps, resolve, reject, requeue) {
    let _tab = null;
    try {
      _tab = await gsChrome.tabsGet(tab.id);
    } catch (error) {
      // assume tab has been discarded
    }
    if (!_tab) {
      gsUtils.warning(
        tab.id,
        `Failed to discard tab. Tab may have already been discarded or removed.`
      );
      resolve(false);
      return;
    }
    tab = _tab;

    if (gsUtils.isSuspendedTab(tab) && tab.status === 'loading') {
      gsUtils.log(tab.id, QUEUE_ID, 'Tab is still loading');
      requeue();
      return;
    }
    if (tgs.isCurrentActiveTab(tab)) {
      gsUtils.log(tab.id, QUEUE_ID, 'Tab is active. Aborting discard.');
      resolve(false);
      return;
    }
    if (gsUtils.isDiscardedTab(tab)) {
      gsUtils.log(tab.id, QUEUE_ID, 'Tab already discarded');
      resolve(false);
      return;
    }
    gsUtils.log(tab.id, QUEUE_ID, 'Forcing discarding of tab.');
    chrome.tabs.discard(tab.id, () => {
      if (chrome.runtime.lastError) {
        gsUtils.warning(tab.id, chrome.runtime.lastError);
        resolve(false);
      } else {
        resolve(true);
      }
    });
  }

  function handleDiscardException(
    tab,
    executionProps,
    exceptionType,
    resolve,
    reject,
    requeue
  ) {
    gsUtils.warning(tab.id, `Failed to discard tab: ${exceptionType}`);
    resolve(false);
  }

  async function handleDiscardedUnsuspendedTab(tab) {
    if (
      gsUtils.shouldSuspendDiscardedTabs() &&
      gsTabSuspendManager.checkTabEligibilityForSuspension(tab, 3)
    ) {
      tgs.setTabStatePropForTabId(tab.id, tgs.STATE_SUSPEND_REASON, 3);
      const suspendedUrl = gsUtils.generateSuspendedUrl(tab.url, tab.title, 0);
      gsUtils.log(tab.id, QUEUE_ID, 'Suspending discarded unsuspended tab');

      // Note: This bypasses the suspension tab queue and also prevents screenshots from being taken
      await gsTabSuspendManager.forceTabSuspension(tab, suspendedUrl);
      return;
    }
  }

  return {
    initAsPromised,
    performInitialisationTabDiscards,
    queueTabForDiscard,
    queueTabForDiscardAsPromise,
    unqueueTabForDiscard,
    handleDiscardedUnsuspendedTab,
  };
})();
