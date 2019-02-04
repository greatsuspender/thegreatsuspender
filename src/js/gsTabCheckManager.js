/*global chrome, localStorage, tgs, gsStorage, gsSession, gsMessages, gsUtils, gsTabDiscardManager, gsChrome, GsTabQueue, gsSuspendedTab */
// eslint-disable-next-line no-unused-vars
var gsTabCheckManager = (function() {
  'use strict';

  const DEFAULT_CONCURRENT_TAB_CHECKS = 3;
  const DEFAULT_TAB_CHECK_TIMEOUT = 15 * 1000;
  const DEFAULT_TAB_CHECK_PROCESSING_DELAY = 500;
  const DEFAULT_TAB_CHECK_REQUEUE_DELAY = 3 * 1000;

  const QUEUE_ID = 'checkQueue';

  let tabCheckQueue;

  // NOTE: This mainly checks suspended tabs
  // For unsuspended tabs, there is no guarantee that the content script will
  // be responsive, but seeing as the timer is kept by the background script, it
  // doesn't really matter.
  // However, when a tab gains focus, there is a check to make sure the content
  // script is responsive, as we then need to rely on the form input and scroll behaviour.
  function initAsPromised() {
    return new Promise(resolve => {
      const queueProps = {
        concurrentExecutors: DEFAULT_CONCURRENT_TAB_CHECKS,
        jobTimeout: DEFAULT_TAB_CHECK_TIMEOUT,
        processingDelay: DEFAULT_TAB_CHECK_PROCESSING_DELAY,
        executorFn: handleTabCheck,
        exceptionFn: handleTabCheckException,
      };
      tabCheckQueue = GsTabQueue(QUEUE_ID, queueProps);
      gsUtils.log('gsTabCheckManager', 'init successful');
      resolve();
    });
  }

  // Suspended tabs that exist or are created before the end of extension
  // initialisation will need to be initialised by this startup script
  async function performInitialisationTabChecks(tabs) {
    // Temporarily change jobTimeout while we are starting up
    const initJobTimeout = Math.max(
      tabs.length * 1000,
      DEFAULT_TAB_CHECK_TIMEOUT
    );
    const initprocessingDelay = DEFAULT_TAB_CHECK_PROCESSING_DELAY;
    updateQueueProps(initJobTimeout, initprocessingDelay);

    const tabCheckPromises = [];
    for (const tab of tabs) {
      if (!gsUtils.isSuspendedTab(tab)) {
        continue;
      }
      tabCheckPromises.push(
        // Set to refetch immediately when being processed on the queue
        // From experience, even if a tab status is 'complete' now, it
        // may actually switch to 'loading' in a few seconds even though a
        // tab reload has not be performed
        queueTabCheckAsPromise(tab, { refetchTab: true }, 3000)
      );
    }

    const results = await Promise.all(tabCheckPromises);

    // Revert timeout
    updateQueueProps(
      DEFAULT_TAB_CHECK_TIMEOUT,
      DEFAULT_TAB_CHECK_PROCESSING_DELAY
    );

    return results;
  }

  function updateQueueProps(jobTimeout, processingDelay) {
    gsUtils.log(
      QUEUE_ID,
      `Setting tabCheckQueue props. jobTimeout: ${jobTimeout}. processingDelay: ${processingDelay}`
    );
    tabCheckQueue.setQueueProperties({
      jobTimeout,
      processingDelay,
    });
  }

  function queueTabCheck(tab, executionProps, processingDelay) {
    queueTabCheckAsPromise(tab, executionProps, processingDelay).catch(e => {
      gsUtils.log(tab.id, QUEUE_ID, e);
    });
  }

  function queueTabCheckAsPromise(tab, executionProps, processingDelay) {
    gsUtils.log(tab.id, QUEUE_ID, `Queuing tab for responsiveness check.`);
    executionProps = executionProps || {};
    return tabCheckQueue.queueTabAsPromise(
      tab,
      executionProps,
      processingDelay
    );
  }

  function getQueuedTabCheckDetails(tab) {
    return tabCheckQueue.getQueuedTabDetails(tab);
  }

  async function handleTabCheckException(
    tab,
    executionProps,
    exceptionType,
    resolve,
    reject,
    requeue
  ) {
    gsUtils.warning(tab.id, `Failed to initialise tab: ${exceptionType}`);
    resolve(false);
  }

  async function handleTabCheck(tab, executionProps, resolve, reject, requeue) {
    if (gsUtils.isSuspendedTab(tab)) {
      checkSuspendedTab(tab, executionProps, resolve, reject, requeue);
    } else if (gsUtils.isNormalTab(tab)) {
      checkNormalTab(tab, executionProps, resolve, reject, requeue);
    }
  }

  async function getUpdatedTab(tab) {
    let _tab = await gsChrome.tabsGet(tab.id);
    if (!_tab) {
      gsUtils.warning(
        tab.id,
        `Failed to initialize tab. Tab may have been discarded or removed.`
      );
      // If we are still initialising, then check for potential discarded tab matches
      if (gsSession.isInitialising()) {
        await queueTabCheckForPotentiallyDiscardedTabs(tab);
      }
    }
    return _tab;
  }

  async function queueTabCheckForPotentiallyDiscardedTabs(tab) {
    // NOTE: For some reason querying by url doesn't work here??
    // TODO: Report chrome bug
    let tabs = await gsChrome.tabsQuery({
      discarded: true,
      windowId: tab.windowId,
    });
    tabs = tabs.filter(o => o.url === tab.url);
    gsUtils.log(
      tab.id,
      QUEUE_ID,
      'Searching for discarded tab matching tab: ',
      tab
    );
    const matchingTab = tabs.find(o => o.index === tab.index);
    if (matchingTab) {
      tabs = [matchingTab];
    }
    for (const tab of tabs) {
      await resuspendSuspendedTab(tab);
      queueTabCheck(tab, { refetchTab: true }, 2000);
    }
  }

  async function checkSuspendedTab(
    tab,
    executionProps,
    resolve,
    reject,
    requeue
  ) {
    if (executionProps.refetchTab) {
      gsUtils.log(
        tab.id,
        QUEUE_ID,
        'Tab refetch requested. Getting updated tab..'
      );
      tab = await getUpdatedTab(tab);
      if (!tab) {
        resolve(gsUtils.STATUS_UNKNOWN);
        return;
      }
      gsUtils.log(tab.id, QUEUE_ID, 'Updated tab: ', tab);

      // Ensure tab is still suspended
      if (!gsUtils.isSuspendedTab(tab)) {
        gsUtils.log(tab.id, 'Tab is no longer suspended. Aborting check.');
        resolve(gsUtils.STATUS_UNKNOWN);
        return;
      }

      // If tab has a state of loading, then requeue for checking later
      if (tab.status === 'loading') {
        gsUtils.log(tab.id, QUEUE_ID, 'Tab is still loading');
        requeue(DEFAULT_TAB_CHECK_REQUEUE_DELAY, { refetchTab: true });
        return;
      }
    }

    // Make sure tab is registered as a 'view' of the extension
    const suspendedView = tgs.getInternalViewByTabId(tab.id);
    if (!suspendedView) {
      gsUtils.log(
        tab.id,
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
        gsUtils.warning(tab.id, 'Failed to resuspend tab');
        resolve(gsUtils.STATUS_UNKNOWN);
        return;
      }
      requeue(DEFAULT_TAB_CHECK_REQUEUE_DELAY);
      return;
    }

    // If tab is a file:// tab and file is blocked then unsuspend tab
    if (!gsSession.isFileUrlsAccessAllowed()) {
      const originalUrl = gsUtils.getOriginalUrl(tab.url);
      if (originalUrl && originalUrl.indexOf('file') === 0) {
        gsUtils.log(tab.id, QUEUE_ID, 'Unsuspending blocked local file tab.');
        await unsuspendSuspendedTab(tab);
        requeue(DEFAULT_TAB_CHECK_REQUEUE_DELAY, { refetchTab: true });
        return;
      }
    }

    const tabSessionOk =
      suspendedView.document.sessionId === gsSession.getSessionId();
    const tabVisibleOk = ensureSuspendedTabVisible(suspendedView);
    const tabBasicsOk = ensureSuspendedTabTitleAndFaviconSet(tab);
    if (!tabSessionOk || !tabVisibleOk || !tabBasicsOk) {
      const tabQueueDetails = tabCheckQueue.getQueuedTabDetails(tab);
      if (!tabQueueDetails) {
        resolve(gsUtils.STATUS_UNKNOWN);
        return;
      }
      try {
        gsUtils.log(tab.id, 'Reinitialising suspendedTab: ', tab);
        await gsSuspendedTab.initTab(tab, suspendedView);
        requeue(DEFAULT_TAB_CHECK_REQUEUE_DELAY, { refetchTab: true });
      } catch (e) {
        gsUtils.log(tab.id, 'Failed to reinitialise suspendedTab. ', e);
        resolve(gsUtils.STATUS_UNKNOWN);
      }
      return;
    }

    queueForDiscardIfRequired(tab);
    resolve(gsUtils.STATUS_SUSPENDED);
  }

  async function resuspendSuspendedTab(tab) {
    gsUtils.log(tab.id, QUEUE_ID, 'Resuspending unresponsive suspended tab.');
    const suspendedView = tgs.getInternalViewByTabId(tab.id);
    if (suspendedView) {
      tgs.setTabStatePropForTabId(
        tab.id,
        tgs.STATE_DISABLE_UNSUSPEND_ON_RELOAD,
        true
      );
    }
    const reloadOk = await gsChrome.tabsReload(tab.id);
    return reloadOk;
  }

  async function unsuspendSuspendedTab(tab) {
    const originalUrl = gsUtils.getOriginalUrl(tab.url);
    await gsChrome.tabsUpdate(tab.id, { url: originalUrl });
  }

  function queueForDiscardIfRequired(tab) {
    // Do not discard during initialisation
    if (gsSession.isInitialising()) {
      return;
    }
    // If we want to discard tabs after suspending them
    let discardAfterSuspend = gsStorage.getOption(
      gsStorage.DISCARD_AFTER_SUSPEND
    );
    if (discardAfterSuspend && !gsUtils.isDiscardedTab(tab)) {
      gsTabDiscardManager.queueTabForDiscard(tab);
    }
  }

  function ensureSuspendedTabVisible(tabView) {
    if (!tabView) {
      return false;
    }
    const bodyEl = tabView.document.getElementsByTagName('body')[0];
    if (!bodyEl) {
      return false;
    }
    return !bodyEl.classList.contains('hide-initially');
  }

  function ensureSuspendedTabTitleAndFaviconSet(tab) {
    if (!tab.favIconUrl || tab.favIconUrl.indexOf('data:image') !== 0) {
      gsUtils.log(tab.id, QUEUE_ID, 'Tab favicon not set or not dataUrl.', tab);
      return false;
    }
    if (!tab.title) {
      gsUtils.log(tab.id, QUEUE_ID, 'Tab title not set', tab);
      return false;
    }
    return true;
  }

  async function checkNormalTab(tab, executionProps, resolve, reject, requeue) {
    if (executionProps.refetchTab) {
      gsUtils.log(
        tab.id,
        QUEUE_ID,
        'Tab refetch requested. Getting updated tab..'
      );
      tab = await getUpdatedTab(tab);
      if (!tab) {
        resolve(gsUtils.STATUS_UNKNOWN);
        return;
      }
      gsUtils.log(tab.id, QUEUE_ID, 'Updated tab: ', tab);

      // Ensure tab is not suspended
      if (gsUtils.isSuspendedTab(tab, true)) {
        gsUtils.log(tab.id, 'Tab is suspended. Aborting check.');
        resolve(gsUtils.STATUS_SUSPENDED);
        return;
      }

      // If tab has a state of loading, then requeue for checking later
      if (tab.status === 'loading') {
        gsUtils.log(tab.id, QUEUE_ID, 'Tab is still loading');
        requeue(DEFAULT_TAB_CHECK_REQUEUE_DELAY, { refetchTab: true });
        return;
      }
    }

    if (gsUtils.isDiscardedTab(tab)) {
      if (tab.active) {
        gsUtils.log(
          tab.id,
          QUEUE_ID,
          'Tab is discarded but active. Will wait for auto reload.'
        );
        requeue(500, { refetchTab: true });
      } else {
        gsUtils.log(tab.id, QUEUE_ID, 'Tab is discarded. Will reload.');
        await gsChrome.tabsReload(tab.id);
        requeue(DEFAULT_TAB_CHECK_REQUEUE_DELAY, { refetchTab: true });
      }
      return;
    }

    let tabInfo = await new Promise(r => {
      gsMessages.sendRequestInfoToContentScript(tab.id, (error, tabInfo) =>
        r(tabInfo)
      );
    });

    if (tabInfo) {
      resolve(tabInfo.status);
      return;
    }

    const queuedTabDetails = tabCheckQueue.getQueuedTabDetails(tab);
    if (!queuedTabDetails) {
      gsUtils.log(tab.id, 'Tab missing from suspensionQueue?');
      resolve(gsUtils.STATUS_UNKNOWN);
      return;
    }

    if (tab.active && queuedTabDetails.requeues === 0) {
      gsUtils.log(
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
      resolve(gsUtils.STATUS_UNKNOWN);
    }
  }

  // Careful with this function. It seems that these unresponsive tabs can sometimes
  // not return any result after chrome.tabs.executeScript
  // Try to mitigate this by wrapping in a setTimeout
  // TODO: Report chrome bug
  // Unrelated, but reinjecting content scripts has some issues:
  // https://groups.google.com/a/chromium.org/forum/#!topic/chromium-extensions/QLC4gNlYjbA
  // https://bugs.chromium.org/p/chromium/issues/detail?id=649947
  // Notably (for me), the key listener of the old content script remains active
  // if using: window.addEventListener('keydown', formInputListener);
  function reinjectContentScriptOnTab(tab) {
    return new Promise(resolve => {
      gsUtils.log(
        tab.id,
        'Reinjecting contentscript into unresponsive unsuspended tab.',
        tab
      );
      const executeScriptTimeout = setTimeout(() => {
        gsUtils.log(
          tab.id,
          'chrome.tabs.executeScript failed to trigger callback'
        );
        resolve(null);
      }, 10000);
      gsMessages.executeScriptOnTab(tab.id, 'js/contentscript.js', error => {
        clearTimeout(executeScriptTimeout);
        if (error) {
          gsUtils.log(
            tab.id,
            'Failed to execute js/contentscript.js on tab',
            error
          );
          resolve(null);
          return;
        }
        tgs
          .initialiseTabContentScript(tab)
          .then(tabInfo => {
            resolve(tabInfo);
          })
          .catch(error => {
            resolve(null);
          });
      });
    });
  }

  return {
    initAsPromised,
    performInitialisationTabChecks,
    queueTabCheck,
    queueTabCheckAsPromise,
    getQueuedTabCheckDetails,
    ensureSuspendedTabVisible,
  };
})();
