/*global chrome, localStorage, tgs, gsStorage, gsSession, gsUtils, gsTabSuspendManager, gsTabDiscardManager, gsChrome, gsMessages, GsTabQueue */
// eslint-disable-next-line no-unused-vars
var gsTabCheckManager = (function() {
  'use strict';

  const DEFAULT_CONCURRENT_TAB_CHECKS = 1;
  const DEFAULT_TAB_CHECK_TIMEOUT = 5 * 1000;
  const DEFAULT_MAX_REQUEUE_ATTEMPTS = 3;

  let tabCheckQueue;

  function initAsPromised() {
    return new Promise(resolve => {
      const queueProps = {
        concurrentExecutors: DEFAULT_CONCURRENT_TAB_CHECKS,
        executorTimeout: DEFAULT_TAB_CHECK_TIMEOUT,
        maxRequeueAttempts: DEFAULT_MAX_REQUEUE_ATTEMPTS,
        executorFn: performTabCheck,
        exceptionFn: handleTabCheckException,
      };
      tabCheckQueue = GsTabQueue('tabCheckQueue', queueProps);
      resolve();
    });
  }

  async function performInitialisationTabChecks(tabs) {
    // Temporarily change maxRequeueAttempts while we are starting up
    const defaultRequeueDelay = 5000; // from gsTabQueue
    const totalInitTimeoutInSeconds = Math.max(tabs.length * 1000, 5000);
    const maxRequeueAttempts = Math.max(
      parseInt(totalInitTimeoutInSeconds / defaultRequeueDelay),
      3
    );
    updateQueueProps(maxRequeueAttempts);

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
    updateQueueProps(DEFAULT_TAB_CHECK_TIMEOUT, DEFAULT_MAX_REQUEUE_ATTEMPTS);
    return results;
  }

  function updateQueueProps(maxRequeueAttempts) {
    gsUtils.log(
      'gsTabCheckManager',
      `Setting tabCheckQueue maxRequeueAttempts to ${maxRequeueAttempts}`
    );
    tabCheckQueue.setQueueProperties({
      maxRequeueAttempts,
    });
  }

  function handleTabCheckException(tab, resolve, reject, requeue) {
    gsUtils.warning(tab.id, 'Failed to initialise suspended tab :(');
    resolve(false);
  }

  function queueTabCheck(tab) {
    queueTabCheckAsPromise(tab);
  }

  function queueTabCheckAsPromise(tab) {
    gsUtils.log(tab.id, `Queuing tab for responsiveness check.`);
    return tabCheckQueue.queueTabAsPromise(tab);
  }

  function getQueuedTabCheckAsPromise(tab) {
    return tabCheckQueue.getQueuedTabAsPromise(tab);
  }

  // This is called remotely by the tabCheckQueue
  // So we must first re-fetch the tab in case it has changed
  async function performTabCheck(tab, resolve, reject, requeue) {
    let _tab = await fetchUpdatedTab(tab);
    if (!_tab) {
      gsUtils.warning(
        tab.id,
        `Failed to initialize tab. Tab may have been removed.`
      );
      resolve(false);
      return;
    }
    tab = _tab;

    // If tab has a state of loading, then requeue for checking later
    if (tab.status === 'loading') {
      gsUtils.log(tab.id, 'Tab is still loading');
      requeue();
      return;
    }
    if (gsUtils.isSuspendedTab(tab)) {
      checkSuspendedTab(tab, resolve, reject, requeue);
    } else {
      checkUnsuspendedTab(tab, resolve, reject, requeue);
    }
  }

  async function fetchUpdatedTab(tab) {
    let newTab = await gsChrome.tabsGet(tab.id);
    if (newTab) {
      return newTab;
    }
    gsUtils.log(tab.id, 'Failed to get tab. It may have been discarded.');

    // If we are still initialising, then check for potential discarded tab matches
    if (gsSession.isInitialising()) {
      newTab = await findPotentialDiscardedTab(tab);
    }
    return newTab;
  }

  async function findPotentialDiscardedTab(tab) {
    // NOTE: For some reason querying by url doesn't work here??
    // TODO: Report chrome bug
    let tabs = await gsChrome.tabsQuery({
      discarded: true,
      windowId: tab.windowId,
    });
    tabs = tabs.filter(o => o.url === tab.url);
    gsUtils.log(tab.id, 'Searching for discarded tab matching tab: ', tab);
    let matchingTab = null;
    if (tabs.length === 1) {
      matchingTab = tabs[0];
    } else if (tabs.length > 1) {
      matchingTab = tabs.find(o => o.index === tab.index);
      matchingTab = matchingTab || tabs[0];
    }
    if (matchingTab) {
      gsUtils.log('gsSession', 'Potential discarded tabs: ', tabs);
      gsUtils.log(
        tab.id,
        'Updating tab with discarded version: ' + matchingTab.id
      );
      return matchingTab;
    } else {
      gsUtils.log(
        tab.id,
        'Could not find any potential matching discarded tabs.'
      );
      return null;
    }
  }

  async function checkUnsuspendedTab(tab, resolve, reject, requeue) {
    if (gsUtils.isDiscardedTab(tab)) {
      handleDiscardedUnsuspendedTab(tab);
      requeue();
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
      // It seems that if you use 'Continue where you left off' that any discarded
      // tabs from the last session will be restored as discarded, but they will not
      // have .discarded = false. This will cause ping and reinjection to fail
      // TODO: Report chrome bug

      // Try to reinject content script
      const result = await reinjectContentScriptOnTab(tab);
      if (!result) {
        gsUtils.warning(tab.id, 'Assuming tab has been discarded.');
        handleDiscardedUnsuspendedTab(tab);
        requeue();
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
      requeue();
      return;
    }

    // If tab returned a response but is not initialised, then try to initialise
    if (!tabResponse.isInitialised) {
      try {
        tabResponse = await tgs.initialiseUnsuspendedTabAsPromised(tab);
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

  async function handleDiscardedUnsuspendedTab(tab) {
    if (
      !gsUtils.shouldSuspendDiscardedTabs() ||
      !gsTabSuspendManager.checkTabEligibilityForSuspension(tab, 3)
    ) {
      gsUtils.log(tab.id, 'Forcing reload of discarded unsuspended tab');
      await gsChrome.tabsUpdate(tab.id, { url: tab.url });
      return;
    }

    tgs.setTabFlagForTabId(tab.id, tgs.TF_SUSPEND_REASON, 3);
    var suspendedUrl = gsUtils.generateSuspendedUrl(tab.url, tab.title, 0);
    gsUtils.log(tab.id, 'Suspending discarded unsuspended tab');
    await gsTabSuspendManager.forceTabSuspension(tab, suspendedUrl);
  }

  async function checkSuspendedTab(tab, resolve, reject, requeue) {
    // If suspended tab has been discarded before check then it may stay in 'blockhead' state
    // Therefore we want to reload this tab to make sure it can be suspended properly
    if (gsUtils.isDiscardedTab(tab)) {
      gsUtils.warning(
        tab.id,
        `Suspended tab was discarded before check. Will reload discarded tab..`
      );
      requestReloadSuspendedTab(tab);
      requeue();
      return;
    }

    // If tab is a file:// tab and file is blocked then unsuspend tab
    if (!gsSession.isFileUrlsAccessAllowed()) {
      const suspendedUrl = gsUtils.getSuspendedUrl(tab.url);
      if (suspendedUrl && suspendedUrl.indexOf('file') === 0) {
        await gsChrome.tabsUpdate(tab.id, { url: suspendedUrl });
        requeue();
        return;
      }
    }

    let tabResponse = await new Promise(resolve => {
      gsMessages.sendPingToTab(tab.id, (error, response) => {
        if (error) {
          gsUtils.log(
            tab.id,
            'Failed to sendPingToTab to suspended tab',
            error
          );
        }
        resolve(response);
      });
    });

    if (!tabResponse) {
      // It seems that if you use 'Continue where you left off' that any discarded
      // tabs from the last session will be restored as discarded, but they will not
      // have .discarded = false. This will cause ping and reinjection to fail
      // Try reloading the tab and requeue for checking later
      requestReloadSuspendedTab(tab);
      requeue();
      return;
    }

    // If tab returned a response but is not initialised, then try to initialise
    if (!tabResponse.isInitialised) {
      try {
        tabResponse = await tgs.initialiseSuspendedTabAsPromised(tab);
      } catch (error) {
        gsUtils.warning(tab.id, 'Failed to initialiseTabAsPromised', error);
      }
    }
    if (!tabResponse || !tabResponse.isInitialised) {
      gsUtils.log(tab.id, 'Failed to initialise suspended tab :(');
      resolve(false);
    } else {
      await performPostSuspensionTabChecks(tab.id);
      gsUtils.log(tab.id, 'Suspended tab initialised successfully');

      // If we want to discard tabs after suspending them
      let discardAfterSuspend = gsStorage.getOption(
        gsStorage.DISCARD_AFTER_SUSPEND
      );
      if (discardAfterSuspend) {
        gsTabDiscardManager.queueTabForDiscard(tab);
      }

      resolve(true);
    }
  }

  function requestReloadSuspendedTab(tab) {
    gsUtils.log(tab.id, 'Resuspending unresponsive suspended tab.');
    tgs.setTabFlagForTabId(tab.id, tgs.TF_UNSUSPEND_ON_RELOAD_URL, null);
    chrome.tabs.reload(tab.id, function() {
      if (chrome.runtime.lastError) {
        gsUtils.warning(tab.id, chrome.runtime.lastError);
      }
    });
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

  async function performPostSuspensionTabChecks(tabId) {
    let tabOk = true;
    const tab = await gsChrome.tabsGet(tabId);
    if (!tab) {
      gsUtils.warning(tabId, 'Could not find post suspended tab');
      return;
    }
    if (!tab.title) {
      gsUtils.warning(tabId, 'Failed to correctly set title', tab);
      tabOk = false;
    }
    if (!tab.favIconUrl || tab.favIconUrl.indexOf('data:image') !== 0) {
      gsUtils.warning(tabId, 'Failed to correctly set favIconUrl', tab);
      tabOk = false;
    }
    if (!tabOk) {
      var payload = {
        favicon: gsUtils.getCleanTabFavicon(tab),
        title: gsUtils.getCleanTabTitle(tab),
      };
      await new Promise(resolve => {
        gsMessages.sendInitSuspendedTab(tabId, payload, resolve); // async. unhandled callback error
      });
    }
  }

  return {
    initAsPromised,
    performInitialisationTabChecks,
    queueTabCheck,
    queueTabCheckAsPromise,
    getQueuedTabCheckAsPromise,
  };
})();
