/*global chrome, localStorage, tgs, gsStorage, gsSession, gsMessages, gsUtils, gsTabDiscardManager, gsChrome, GsTabQueue, gsTabSuspendManager */
// eslint-disable-next-line no-unused-vars
var gsTabCheckManager = (function() {
  'use strict';

  const DEFAULT_CONCURRENT_TAB_CHECKS = 3;
  const DEFAULT_TAB_CHECK_TIMEOUT = 15 * 1000;
  const DEFAULT_TAB_CHECK_PREQUEUE_DELAY = 500;
  const DEFAULT_TAB_CHECK_REQUEUE_DELAY = 5 * 1000;

  const QUEUE_ID = 'checkQueue';

  let tabCheckQueue;

  // NOTE: This currently only checks suspended tabs
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
        prequeueDelay: DEFAULT_TAB_CHECK_PREQUEUE_DELAY,
        executorFn: checkSuspendedTab,
        exceptionFn: handleTabCheckException,
      };
      tabCheckQueue = GsTabQueue(QUEUE_ID, queueProps);
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
    const initPrequeueDelay = 1000;
    updateQueueProps(initJobTimeout, initPrequeueDelay);

    // Temporarily add messageListener to listen for suspended tab init requests
    const messageListener = (request, sender, sendResponse) => {
      if (request.action === 'requestTabMeta') {
        sendResponse(sender.tab);
        return false;
      }
    };
    chrome.runtime.onMessage.addListener(messageListener);

    const tabCheckPromises = [];
    for (const tab of tabs) {
      if (!gsUtils.isSuspendedTab(tab)) {
        continue;
      }

      // For suspended tabs that are restored by chrome on restart (due to
      // continue where you left off), we will need to reload them as they
      // won't be associated with the extension yet
      let internalViewExists = ensureInternalViewExists(tab);
      if (!internalViewExists) {
        await resuspendSuspendedTab(tab);
        tabCheckPromises.push(queueTabCheckAsPromise(tab, false, 1000));
      } else {
        tabCheckPromises.push(queueTabCheckAsPromise(tab, false, 0));
      }
    }

    const results = await Promise.all(tabCheckPromises);

    // Revert timeout
    updateQueueProps(
      DEFAULT_TAB_CHECK_TIMEOUT,
      DEFAULT_TAB_CHECK_PREQUEUE_DELAY
    );

    // Remove temporary listener
    chrome.runtime.onMessage.removeListener(messageListener);

    return results;
  }

  function updateQueueProps(jobTimeout, prequeueDelay) {
    gsUtils.log(
      QUEUE_ID,
      `Setting tabCheckQueue props. jobTimeout: ${jobTimeout}. prequeueDelay: ${prequeueDelay}`
    );
    tabCheckQueue.setQueueProperties({
      jobTimeout,
      prequeueDelay,
    });
  }

  function queueTabCheck(tab, requestTabReload, prequeueDelay) {
    queueTabCheckAsPromise(tab, requestTabReload, prequeueDelay).catch(e => {
      gsUtils.log(tab.id, QUEUE_ID, e);
    });
  }

  function queueTabCheckAsPromise(tab, requestTabReload, prequeueDelay) {
    requestTabReload = Boolean(requestTabReload);
    gsUtils.log(tab.id, QUEUE_ID, `Queuing tab for responsiveness check.`);
    return tabCheckQueue.queueTabAsPromise(
      tab,
      { refetchTab: requestTabReload },
      prequeueDelay
    );
  }

  function getQueuedTabCheckDetails(tab) {
    return tabCheckQueue.getQueuedTabDetails(tab);
  }

  function handleTabCheckException(
    tab,
    executionProps,
    exceptionType,
    resolve,
    reject,
    requeue
  ) {
    gsUtils.warning(
      tab.id,
      `Failed to initialise suspended tab: ${exceptionType}`
    );
    resolve(false);
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
    let matchingTab = tabs.find(o => o.index === tab.index);
    if (matchingTab) {
      tabs = [matchingTab];
    }
    for (const matchingTab of tabs) {
      await resuspendSuspendedTab(matchingTab);
      queueTabCheck(matchingTab, true, 2000);
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
        resolve(false);
        return;
      }
      gsUtils.log(tab.id, QUEUE_ID, 'Updated tab: ', tab);
    }

    // Once we're sure that tab still exists then make sure tab is registered
    // as a 'view' of the extension
    let internalViewExists = ensureInternalViewExists(tab);
    if (!internalViewExists) {
      gsUtils.log(tab.id, 'Internal view does not exist for tab: ', tab);
      resuspendSuspendedTab(tab);
      executionProps.refetchTab = true;
      requeue(DEFAULT_TAB_CHECK_REQUEUE_DELAY);
      return;
    }

    // If tab has a state of loading, then requeue for checking later
    if (tab.status === 'loading') {
      gsUtils.log(tab.id, QUEUE_ID, 'Tab is still loading');
      executionProps.refetchTab = true;
      requeue(DEFAULT_TAB_CHECK_REQUEUE_DELAY);
      return;
    }

    // If tab is a file:// tab and file is blocked then unsuspend tab
    if (!gsSession.isFileUrlsAccessAllowed()) {
      const originalUrl = gsUtils.getOriginalUrl(tab.url);
      if (originalUrl && originalUrl.indexOf('file') === 0) {
        await unsuspendSuspendedTab(tab);
        executionProps.refetchTab = true;
        requeue(DEFAULT_TAB_CHECK_REQUEUE_DELAY);
        return;
      }
    }

    let tabBasicsOk = ensureSuspendedTabTitleAndFaviconSet(tab);
    let tabPropsOk = ensureViewSuspendedTabPropsSet(tab);
    if (!tabBasicsOk || !tabPropsOk) {
      gsUtils.log(tab.id, 'Reinitialising suspendedTab: ', tab);
      const suspendedView = tgs.getInternalViewByTabId(tab.id);
      if (suspendedView) {
        await gsTabSuspendManager.initSuspendedTab(suspendedView, tab);
      }

      const tabQueueDetails = tabCheckQueue.getQueuedTabDetails(tab);
      if (!tabQueueDetails || tabQueueDetails.requeues > 1) {
        resolve(false);
        return;
      }
      executionProps.refetchTab = true;
      requeue(DEFAULT_TAB_CHECK_REQUEUE_DELAY);
      return;
    }

    const backgroundTabPropsOk = ensureBackgroundSuspendedTabPropsSet(tab);
    if (!backgroundTabPropsOk) {
      tgs.initialiseSuspendedTabProps(tab);
    }

    queueForDiscardIfRequired(tab);
    resolve(true);
  }

  async function resuspendSuspendedTab(tab) {
    gsUtils.log(tab.id, QUEUE_ID, 'Resuspending unresponsive suspended tab.');
    const suspendedView = tgs.getInternalViewByTabId(tab.id, true);
    if (suspendedView) {
      suspendedView.exports.disableUnsuspendOnReload();
    }
    await gsChrome.tabsReload(tab.id);
  }

  async function unsuspendSuspendedTab(tab) {
    gsUtils.log(tab.id, QUEUE_ID, 'Unsuspending blocked local file tab.');
    const originalUrl = gsUtils.getOriginalUrl(tab.url);
    await gsChrome.tabsUpdate(tab.id, { url: originalUrl });
  }

  function queueForDiscardIfRequired(tab) {
    // If we want to discard tabs after suspending them
    let discardAfterSuspend = gsStorage.getOption(
      gsStorage.DISCARD_AFTER_SUSPEND
    );
    if (discardAfterSuspend && !gsUtils.isDiscardedTab(tab)) {
      gsTabDiscardManager.queueTabForDiscard(tab);
    }
  }

  function ensureInternalViewExists(tab) {
    const suspendedView = tgs.getInternalViewByTabId(tab.id, true);
    const viewExists = Boolean(suspendedView);
    if (!viewExists) {
      gsUtils.log(tab.id, 'Could not find an internal view for suspended tab.');
    }
    return viewExists;
  }

  function ensureBackgroundSuspendedTabPropsSet(tab) {
    const showNag = tgs.getSuspendedTabPropForTabId(tab.id, tgs.STP_SHOW_NAG);
    const backgroundPropsSet = showNag !== undefined && showNag !== null;
    if (!backgroundPropsSet) {
      gsUtils.log(
        tab.id,
        QUEUE_ID,
        'showNag not set. This may mean suspendedTabProps not set.',
        tab
      );
    }
    return backgroundPropsSet;
  }

  function ensureViewSuspendedTabPropsSet(tab) {
    // TODO: Somehow check preLoadInitProps and postLoadInitProps
    return true;
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

  // Careful with this function. It seems that these unresponsive tabs can sometimes
  // not return any result after chrome.tabs.executeScript
  // Try to mitigate this by wrapping in a setTimeout
  // TODO: Report chrome bug
  // Unrelated, but reinjecting content scripts has some issues:
  // https://groups.google.com/a/chromium.org/forum/#!topic/chromium-extensions/QLC4gNlYjbA
  // https://bugs.chromium.org/p/chromium/issues/detail?id=649947
  // Notably (for me), the key listener of the old content script remains active
  // if using: window.addEventListener('keydown', formInputListener);
  function reinjectContentScriptOnTab(tab, initialise) {
    return new Promise(resolve => {
      gsUtils.log(
        tab.id,
        'Reinjecting contentscript into unresponsive unsuspended tab.'
      );
      const executeScriptTimeout = setTimeout(() => {
        gsUtils.log(
          tab.id,
          'chrome.tabs.executeScript failed to trigger callback'
        );
        resolve(false);
      }, 10000);
      gsMessages.executeScriptOnTab(
        tab.id,
        'js/contentscript.js',
        async error => {
          clearTimeout(executeScriptTimeout);
          if (error) {
            gsUtils.log(
              tab.id,
              'Failed to execute js/contentscript.js on tab',
              error
            );
            resolve(false);
            return;
          }
          if (initialise) {
            try {
              await tgs.initialiseUnsuspendedTabScriptAsPromised(tab);
            } catch (e) {
              resolve(false);
              return;
            }
          }
          resolve(true);
        }
      );
    });
  }

  return {
    initAsPromised,
    performInitialisationTabChecks,
    queueTabCheck,
    queueTabCheckAsPromise,
    getQueuedTabCheckDetails,
    reinjectContentScriptOnTab,
  };
})();
