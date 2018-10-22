/*global chrome, localStorage, tgs, gsUtils, gsChrome, GsTabQueue */
// eslint-disable-next-line no-unused-vars
var gsTabDiscardManager = (function() {
  'use strict';

  const DEFAULT_CONCURRENT_DISCARDS = 1;
  const DEFAULT_DISCARD_TIMEOUT = 5 * 1000;
  const DEFAULT_MAX_REQUEUE_ATTEMPTS = 1;

  let discardQueue;

  function initAsPromised() {
    return new Promise(resolve => {
      const queueProps = {
        concurrentExecutors: DEFAULT_CONCURRENT_DISCARDS,
        executorTimeout: DEFAULT_DISCARD_TIMEOUT,
        maxRequeueAttempts: DEFAULT_MAX_REQUEUE_ATTEMPTS,
        executorFn: performDiscard,
        exceptionFn: handleDiscardException,
      };
      discardQueue = GsTabQueue('tabDiscardQueue', queueProps);
      resolve();
    });
  }

  function handleDiscardException(tab, resolve, reject, requeue) {
    gsUtils.warning(tab.id, 'Failed to discard tab :(');
    resolve(false);
  }

  function queueTabForDiscard(tab) {
    queueTabForDiscardAsPromise(tab);
  }

  function queueTabForDiscardAsPromise(tab) {
    gsUtils.log(tab.id, `Queuing tab for discarding.`);
    return discardQueue.queueTabAsPromise(tab);
  }

  function unqueueTabForDiscard(tab) {
    const removed = discardQueue.unqueueTab(tab);
    if (removed) {
      gsUtils.log(tab.id, `Removed tab from discard queue.`);
    }
  }

  // This is called remotely by the discardQueue
  // So we must first re-fetch the tab in case it has changed
  async function performDiscard(tab, resolve, reject, requeue) {
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
      gsUtils.log(tab.id, 'Tab is still loading');
      requeue();
      return;
    }
    if (tgs.isCurrentActiveTab(tab)) {
      gsUtils.log(tab.id, 'Tab is active. Aborting discard.');
      resolve(false);
      return;
    }
    if (gsUtils.isDiscardedTab(tab)) {
      gsUtils.log(tab.id, 'Tab already discarded');
      resolve(false);
      return;
    }
    gsUtils.log(tab.id, 'Forcing discarding of tab.');
    chrome.tabs.discard(tab.id, () => {
      if (chrome.runtime.lastError) {
        gsUtils.warning(tab.id, chrome.runtime.lastError);
        resolve(false);
      } else {
        resolve(true);
      }
    });
  }

  return {
    initAsPromised,
    queueTabForDiscard,
    queueTabForDiscardAsPromise,
    unqueueTabForDiscard,
  };
})();
