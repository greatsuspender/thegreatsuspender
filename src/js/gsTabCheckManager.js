/*global chrome, localStorage, tgs, gsStorage, gsSession, gsUtils, gsTabDiscardManager, gsChrome, gsMessages, GsTabQueue */
// eslint-disable-next-line no-unused-vars
var gsTabCheckManager = (function() {
  'use strict';

  const DEFAULT_CONCURRENT_TAB_CHECKS = 3;
  const DEFAULT_TAB_CHECK_TIMEOUT = 10 * 1000;
  const DEFAULT_TAB_CHECK_PREQUEUE_DELAY = 500;
  const DEFAULT_TAB_CHECK_REQUEUE_DELAY = 5 * 1000;

  let tabCheckQueue;

  function initAsPromised() {
    return new Promise(resolve => {
      const queueProps = {
        concurrentExecutors: DEFAULT_CONCURRENT_TAB_CHECKS,
        jobTimeout: DEFAULT_TAB_CHECK_TIMEOUT,
        prequeueDelay: DEFAULT_TAB_CHECK_PREQUEUE_DELAY,
        executorFn: performTabCheck,
        exceptionFn: handleTabCheckException,
      };
      tabCheckQueue = GsTabQueue('checkQueue', queueProps);
      resolve();
    });
  }

  async function performInitialisationTabChecks(tabs) {
    // Temporarily change jobTimeout while we are starting up
    const initJobTimeout = Math.max(
      tabs.length * 1000,
      DEFAULT_TAB_CHECK_TIMEOUT
    );
    const initPrequeueDelay = 1000;
    updateQueueProps(initJobTimeout, initPrequeueDelay);

    const tabCheckPromises = [];
    for (const tab of tabs) {
      if (gsUtils.isSpecialTab(tab)) {
        gsUtils.log(tab.id, 'Ignoring check for special tab.');
      } else {
        tabCheckPromises.push(queueTabCheckAsPromise(tab));
      }
    }

    const results = await Promise.all(tabCheckPromises);

    // Revert timeout
    updateQueueProps(
      DEFAULT_TAB_CHECK_TIMEOUT,
      DEFAULT_TAB_CHECK_PREQUEUE_DELAY
    );
    return results;
  }

  function updateQueueProps(jobTimeout, prequeueDelay) {
    gsUtils.log(
      'gsTabCheckManager',
      `Setting tabCheckQueue props. jobTimeout: ${jobTimeout}. prequeueDelay: ${prequeueDelay}`
    );
    tabCheckQueue.setQueueProperties({
      jobTimeout,
      prequeueDelay,
    });
  }

  function queueTabCheck(tab, prequeueDelay) {
    queueTabCheckAsPromise(tab, prequeueDelay).catch(e => {
      gsUtils.log(tab.id, e);
    });
  }

  function queueTabCheckAsPromise(tab, prequeueDelay) {
    gsUtils.log(tab.id, `Queuing tab for responsiveness check.`);
    return tabCheckQueue.queueTabAsPromise(tab, {}, prequeueDelay);
  }

  function getQueuedTabCheckDetails(tab) {
    return tabCheckQueue.getQueuedTabDetails(tab);
  }

  // This is called remotely by the tabCheckQueue
  // So we must first re-fetch the tab in case it has changed
  async function performTabCheck(
    tab,
    executionProps,
    resolve,
    reject,
    requeue
  ) {
    const isSuspended = gsUtils.isSuspendedTab(tab);
    if (isSuspended) {
      checkSuspendedTab(tab, resolve, reject, requeue);
    } else {
      // Dont do any checking on unsuspended tabs anymore now that the timers
      // have been moved out of the content scripts
      // NOTE: This means 'parked on startup' tabs will end up in an unkonwn
      // state instead of being forced discarded
      // checkUnsuspendedTab(tab, resolve, reject, requeue);
      resolve(true);
      return;
    }
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
    gsUtils.log(tab.id, 'Searching for discarded tab matching tab: ', tab);
    let matchingTab = tabs.find(o => o.index === tab.index);
    if (matchingTab) {
      queueTabCheck(matchingTab);
    } else {
      for (const matchingTab of tabs) {
        queueTabCheck(matchingTab);
      }
    }
  }

  async function checkUnsuspendedTab(tab, resolve, reject, requeue) {
    tab = await getUpdatedTab(tab);
    if (!tab) {
      resolve(false);
      return;
    }

    // If tab has a state of loading, then requeue for checking later
    if (tab.status === 'loading') {
      gsUtils.log(tab.id, 'Tab is still loading');
      requeue(DEFAULT_TAB_CHECK_REQUEUE_DELAY);
      return;
    }

    if (gsUtils.isDiscardedTab(tab)) {
      gsUtils.log(tab.id, 'Unsuspended tab is discarded :(');
      resolve(false);
      return;
    }

    let tabResponse = await new Promise(resolve => {
      gsMessages.sendPingToTab(tab.id, function(error, _response) {
        if (error) {
          gsUtils.log(
            tab.id,
            'Failed to sendPingToTab to unsuspended tab',
            error
          );
        }
        resolve(_response);
      });
    });

    if (!tabResponse) {
      // Try to reinject content script
      const result = await reinjectContentScriptOnTab(tab);
      if (!result) {
        // If you use 'Continue where you left off', tabs from the last session
        // will be restored as if discarded, but they will not have .discarded = false.
        // This will cause ping and reinjection to fail
        // TODO: Report chrome bug
        gsUtils.log(
          tab.id,
          'Assuming tab is parked on startup. Will queue for proper discard.'
        );
        gsTabDiscardManager.queueTabForDiscard(tab);
        resolve(false);
        return;
      }

      // If we have successfull injected content script, then try to ping again
      tabResponse = await new Promise(resolve => {
        gsMessages.sendPingToTab(tab.id, function(error, _response) {
          resolve(_response);
        });
      });
    }

    // If tab still doesn't respond to ping, then requeue for checking later
    if (!tabResponse) {
      requeue(DEFAULT_TAB_CHECK_REQUEUE_DELAY);
      return;
    }

    // If tab returned a response but is not initialised, then try to initialise
    if (!tabResponse.isInitialised) {
      try {
        tabResponse = await tgs.initialiseUnsuspendedTabScriptAsPromised(tab);
      } catch (error) {
        gsUtils.warning(tab.id, 'Failed to initialiseTabAsPromised', error);
      }
    }

    if (!tabResponse || !tabResponse.isInitialised) {
      gsUtils.log(tab.id, 'Failed to initialise unsuspended tab :(');
      resolve(false);
    } else {
      gsUtils.log(tab.id, 'Unsuspended tab initialised successfully');
      resolve(true);
    }
  }

  async function checkSuspendedTab(tab, resolve, reject, requeue) {
    tab = await getUpdatedTab(tab);
    if (!tab) {
      resolve(false);
      return;
    }

    // If tab has a state of loading, then requeue for checking later
    if (tab.status === 'loading') {
      gsUtils.log(tab.id, 'Tab is still loading');
      requeue(DEFAULT_TAB_CHECK_REQUEUE_DELAY);
      return;
    }

    // If tab is a file:// tab and file is blocked then unsuspend tab
    if (!gsSession.isFileUrlsAccessAllowed()) {
      const suspendedUrl = gsUtils.getSuspendedUrl(tab.url);
      if (suspendedUrl && suspendedUrl.indexOf('file') === 0) {
        await gsChrome.tabsUpdate(tab.id, { url: suspendedUrl });
        requeue(DEFAULT_TAB_CHECK_REQUEUE_DELAY);
        return;
      }
    }

    // All we really care about with suspended tabs is that the favicon and title
    // are set correctly. If so, then resolve early.
    let tabOk = performPostSuspensionTabChecks(tab);
    if (tabOk) {
      queueForDiscardIfRequired(tab);
      resolve(true);
      return;
    }

    gsUtils.log(tab.id, 'Tab favicon or title not set', tab);

    if (gsUtils.isDiscardedTab(tab)) {
      gsUtils.warning(
        tab.id,
        `Suspended tab was discarded before check. Will reload discarded tab..`
      );
      await requestReloadSuspendedTab(tab);
      requeue(DEFAULT_TAB_CHECK_REQUEUE_DELAY);
      return;
    }

    let tabResponse;
    try {
      tabResponse = await tgs.initialiseSuspendedTabScriptAsPromised(tab);
    } catch (error) {
      gsUtils.warning(tab.id, 'Failed to initialiseTabAsPromised', error);
    }

    if (!tabResponse) {
      // If you use 'Continue where you left off', tabs from the last session
      // will be restored as if discarded, but they will not have .discarded = false.
      await requestReloadSuspendedTab(tab);
      requeue(DEFAULT_TAB_CHECK_REQUEUE_DELAY);
      return;
    }

    if (!tabResponse.isInitialised) {
      gsUtils.log(tab.id, 'Failed to initialise suspended tab :(');
      resolve(false);
      return;
    }
    gsUtils.log(tab.id, 'Suspended tab initialised successfully');

    const updatedTab = await gsChrome.tabsGet(tab.id);
    tabOk = performPostSuspensionTabChecks(updatedTab);
    if (!tabOk) {
      gsUtils.log(tab.id, 'Tab favicon or title still not set', tab);
      await forceReinitOfSuspendedTabFaviconAndTitle(updatedTab);
    }

    queueForDiscardIfRequired(updatedTab);
    resolve(true);
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

  async function requestReloadSuspendedTab(tab) {
    gsUtils.log(tab.id, 'Resuspending unresponsive suspended tab.');
    tgs.setSuspendedTabPropForTabId(
      tab.id,
      tgs.STP_UNSUSPEND_ON_RELOAD_URL,
      null
    );
    await gsChrome.tabsReload(tab.id);
  }

  // Careful with this function. It seems that these unresponsive tabs can sometimes
  // not return any result after chrome.tabs.executeScript
  // Try to mitigate this by wrapping in a setTimeout
  // TODO: Report chrome bug
  function reinjectContentScriptOnTab(tab) {
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
      gsMessages.executeScriptOnTab(tab.id, 'js/contentscript.js', error => {
        clearTimeout(executeScriptTimeout);
        if (error) {
          gsUtils.log(
            tab.id,
            'Failed to execute js/contentscript.js on tab',
            error
          );
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });
  }

  function performPostSuspensionTabChecks(tab) {
    let tabOk = true;
    if (!tab) {
      gsUtils.log(tab.id, 'Could not find post suspended tab');
      return;
    }
    if (!tab.title) {
      tabOk = false;
    }
    if (!tab.favIconUrl || tab.favIconUrl.indexOf('data:image') !== 0) {
      tabOk = false;
    }
    return tabOk;
  }

  async function forceReinitOfSuspendedTabFaviconAndTitle(tab) {
    var payload = {
      favicon: gsUtils.getCleanTabFavicon(tab),
      title: gsUtils.getCleanTabTitle(tab),
    };
    await new Promise(resolve => {
      gsMessages.sendInitSuspendedTab(tab.id, payload, resolve); // async. unhandled callback error
    });
  }

  return {
    initAsPromised,
    performInitialisationTabChecks,
    queueTabCheck,
    queueTabCheckAsPromise,
    getQueuedTabCheckDetails,
  };
})();
