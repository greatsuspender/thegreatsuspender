/*global chrome, localStorage, tgs, gsStorage, gsIndexedDb, gsUtils, gsSuspendManager, gsChrome, gsMessages, gsAnalytics */
// eslint-disable-next-line no-unused-vars
var gsSession = (function() {
  'use strict';

  const tabsToInitPerSecond = 8;
  const updateUrl = chrome.extension.getURL('update.html');
  const updatedUrl = chrome.extension.getURL('updated.html');

  let initialisationMode = false;
  let initPeriodInSeconds;
  let initTimeoutInSeconds;
  let sessionId;
  let recoveryTabId;
  let updateType = null;
  let updated = false;

  let startupTabCheckTimeTakenInSeconds;
  let startupRecoveryTimeTakenInSeconds;
  let startupType;
  let startupLastVersion;

  function initAsPromised() {
    return new Promise(async function(resolve) {
      //remove any update screens
      await Promise.all([
        gsUtils.removeTabsByUrlAsPromised(updateUrl),
        gsUtils.removeTabsByUrlAsPromised(updatedUrl),
      ]);

      //handle special event where an extension update is available
      chrome.runtime.onUpdateAvailable.addListener(function(details) {
        prepareForUpdate(details); //async
      });
      resolve();
    });
  }

  async function prepareForUpdate(newVersionDetails) {
    var currentVersion = chrome.runtime.getManifest().version;
    var newVersion = newVersionDetails.version;

    gsUtils.log(
      'gsSession',
      'A new version is available: ' + currentVersion + ' -> ' + newVersion
    );

    let sessionRestorePoint;
    const currentSession = await buildCurrentSession();
    if (currentSession) {
      sessionRestorePoint = await gsIndexedDb.createOrUpdateSessionRestorePoint(
        currentSession,
        currentVersion
      );
    }

    const suspendedTabCount = await gsUtils.getSuspendedTabCount();
    if (!sessionRestorePoint || suspendedTabCount > 0) {
      //show update screen
      await gsChrome.tabsCreate(updateUrl);
    } else {
      // if there are no suspended tabs then simply install the update immediately
      chrome.runtime.reload();
    }
  }

  function getSessionId() {
    if (!sessionId) {
      //turn this into a string to make comparisons easier further down the track
      sessionId = Date.now() + '';
      gsUtils.log('gsSession', 'sessionId: ', sessionId);
    }
    return sessionId;
  }

  async function buildCurrentSession() {
    const currentWindows = await gsChrome.windowsGetAll();
    var tabsExist = currentWindows.some(
      window => window.tabs && window.tabs.length
    );
    if (tabsExist) {
      const currentSession = {
        sessionId: getSessionId(),
        windows: currentWindows,
        date: new Date().toISOString(),
      };
      return currentSession;
    }
    gsUtils.error('gsSession', 'Failed to build current session!');
    return null;
  }

  async function updateCurrentSession() {
    const currentSession = await buildCurrentSession();
    if (currentSession) {
      await gsIndexedDb.updateSession(currentSession);
    }
  }

  function isUpdated() {
    return updated;
  }

  function isInitialising() {
    return initialisationMode;
  }

  function getTabCheckTimeTakenInSeconds() {
    return startupTabCheckTimeTakenInSeconds;
  }

  function getRecoveryTimeTakenInSeconds() {
    return startupRecoveryTimeTakenInSeconds;
  }

  function getStartupType() {
    return startupType;
  }

  function getStartupLastVersion() {
    return startupLastVersion;
  }

  function getUpdateType() {
    return updateType;
  }

  async function runStartupChecks() {
    initialisationMode = true;
    const currentSessionTabs = await gsChrome.tabsQuery();
    gsUtils.log('gsSession', 'preRecoverySessionTabs:', currentSessionTabs);

    const curVersion = chrome.runtime.getManifest().version;
    startupLastVersion = gsStorage.fetchLastVersion();

    if (chrome.extension.inIncognitoContext) {
      // do nothing if in incognito context
      startupType = 'Incognito';
    } else if (startupLastVersion === curVersion) {
      gsUtils.log('gsSession', 'HANDLING NORMAL STARTUP');
      startupType = 'Restart';
      await handleNormalStartup(currentSessionTabs, curVersion);
    } else if (!startupLastVersion || startupLastVersion === '0.0.0') {
      gsUtils.log('gsSession', 'HANDLING NEW INSTALL');
      startupType = 'Install';
      await handleNewInstall(curVersion);
    } else {
      gsUtils.log('gsSession', 'HANDLING UPDATE');
      startupType = 'Update';
      await handleUpdate(currentSessionTabs, curVersion, startupLastVersion);
    }
  }

  async function handleNormalStartup(currentSessionTabs, curVersion) {
    const shouldRecoverTabs = await checkForCrashRecovery(currentSessionTabs);
    if (shouldRecoverTabs) {
      var lastExtensionRecoveryTimestamp = gsStorage.fetchLastExtensionRecoveryTimestamp();
      var hasCrashedRecently =
        lastExtensionRecoveryTimestamp &&
        Date.now() - lastExtensionRecoveryTimestamp < 1000 * 60 * 5;
      gsStorage.setLastExtensionRecoveryTimestamp(Date.now());

      if (!hasCrashedRecently) {
        //if this is the first recent crash, then automatically recover lost tabs
        await recoverLostTabs();
      } else {
        //otherwise show the recovery page
        const recoveryUrl = chrome.extension.getURL('recovery.html');
        const recoveryTab = await gsChrome.tabsCreate(recoveryUrl);
        recoveryTabId = recoveryTab.id;
        //hax0r: wait for recovery tab to finish loading before returning
        //this is so we remain in 'recoveryMode' for a bit longer, preventing
        //the sessionUpdate code from running when this tab gains focus
        await gsUtils.setTimeout(2000);
      }
    } else {
      await gsIndexedDb.trimDbItems();
    }
  }

  async function handleNewInstall(curVersion) {
    gsStorage.setLastVersion(curVersion);

    //show welcome message
    const optionsUrl = chrome.extension.getURL('options.html?firstTime');
    await gsChrome.tabsCreate(optionsUrl);
  }

  async function handleUpdate(currentSessionTabs, curVersion, lastVersion) {
    gsStorage.setLastVersion(curVersion);
    var lastVersionParts = lastVersion.split('.');
    var curVersionParts = curVersion.split('.');
    if (lastVersionParts.length >= 2 && curVersionParts.length >= 2) {
      if (parseInt(curVersionParts[0]) > parseInt(lastVersionParts[0])) {
        updateType = 'major';
      } else if (parseInt(curVersionParts[1]) > parseInt(lastVersionParts[1])) {
        updateType = 'minor';
      } else {
        updateType = 'patch';
      }
    }

    const sessionRestorePoint = await gsIndexedDb.fetchSessionRestorePoint(
      lastVersion
    );
    if (!sessionRestorePoint) {
      const lastSession = await gsIndexedDb.fetchLastSession();
      if (lastSession) {
        await gsIndexedDb.createOrUpdateSessionRestorePoint(
          lastSession,
          lastVersion
        );
      } else {
        gsUtils.error(
          'gsSession',
          'No session restore point found, and no lastSession exists!'
        );
      }
    }

    await gsUtils.removeTabsByUrlAsPromised(updateUrl);
    await gsUtils.removeTabsByUrlAsPromised(updatedUrl);

    await gsIndexedDb.performMigration(lastVersion);
    gsStorage.setNoticeVersion('0');
    const shouldRecoverTabs = await checkForCrashRecovery(currentSessionTabs);
    if (shouldRecoverTabs) {
      const updatedTab = await gsUtils.createTabAndWaitForFinishLoading(
        updatedUrl,
        10000
      );

      await recoverLostTabs();
      updated = true;

      //update updated screen
      const error = await new Promise(resolve => {
        gsMessages.sendUpdateCompleteToUpdatedTab(updatedTab.id, error => {
          resolve(error);
        });
      });
      if (error) {
        await gsUtils.removeTabsByUrlAsPromised(updatedUrl);
        await gsChrome.tabsCreate({ url: updatedUrl });
      }
    } else {
      updated = true;
      await gsChrome.tabsCreate({ url: updatedUrl });
    }
  }

  // This function is used only for testing
  async function triggerDiscardOfAllTabs() {
    await new Promise((resolve) => {
      chrome.tabs.query({active: false, discarded: false}, function (tabs) {
        for (var i = 0; i < tabs.length; ++i) {
          if (tabs[i] === undefined || gsUtils.isSpecialTab(tabs[i])) {
            continue;
          }
          gsSuspendManager.forceTabDiscardation(tabs[i]);
        }
        resolve();
      });
    });
  }

  async function checkTabsForResponsiveness() {
    //make sure the contentscript / suspended script of each tab is responsive
    //if we are in the process of a chrome restart (and session restore) then it might take a while
    //for the scripts to respond. we use progressive timeouts of 4, 8, 16, 32 ...
    const tabCheckPromises = [];
    const initStartTime = Date.now();
    gsUtils.log(
      'gsSession',
      '\n\n------------------------------------------------\n' +
        `Checking tabs for responsiveness..\n` +
        '------------------------------------------------\n\n'
    );
    const currentSessionTabs = await gsChrome.tabsQuery();
    gsUtils.log('gsSession', 'postRecoverySessionTabs:', currentSessionTabs);

    initPeriodInSeconds = currentSessionTabs.length / tabsToInitPerSecond;
    initTimeoutInSeconds = initPeriodInSeconds * 15;
    gsUtils.log('gsSession', `initPeriodInSeconds: ${initPeriodInSeconds}`);
    gsUtils.log('gsSession', `initTimeoutInSeconds: ${initTimeoutInSeconds}`);

    for (const currentTab of currentSessionTabs) {
      const timeout = getRandomTimeoutInMilliseconds(1000);
      gsUtils.log(
        currentTab.id,
        `Queuing tab for responsiveness check in ${timeout / 1000} seconds.`
      );
      tabCheckPromises.push(queueTabInitialisation(currentTab, timeout));
    }
    return Promise.all(tabCheckPromises)
      .then(() => {
        initialisationMode = false;
        startupTabCheckTimeTakenInSeconds = parseInt(
          (Date.now() - initStartTime) / 1000
        );
        gsUtils.log(
          'gsSession',
          '\n\n------------------------------------------------\n' +
            'Checking tabs finished. Time taken: ' +
            startupTabCheckTimeTakenInSeconds +
            ' sec\n' +
            '------------------------------------------------\n\n'
        );
      })
      .catch(error => {
        initialisationMode = false;
        gsUtils.warning('gsSession', error);
        gsUtils.warning(
          'gsSession',
          '\n\n------------------------------------------------\n' +
            'Extension initialisation FAILED.\n' +
            '------------------------------------------------\n\n'
        );
        gsAnalytics.reportException('Extension initialisation failed.');
      });
  }

  function getRandomTimeoutInMilliseconds(minimumTimeout) {
    minimumTimeout = minimumTimeout || 1000;
    const timeoutRandomiser = parseInt(
      Math.random() * initPeriodInSeconds * 1000
    );
    return timeoutRandomiser + minimumTimeout;
  }

  async function checkForCrashRecovery(currentSessionTabs) {
    gsUtils.log(
      'gsSession',
      'Checking for crash recovery: ' + new Date().toISOString()
    );

    //try to detect whether the extension has crashed as apposed to chrome restarting
    //if it is an extension crash, then in theory all suspended tabs will be gone
    //and all normal tabs will still exist with the same ids
    const currentSessionSuspendedTabs = currentSessionTabs.filter(
      tab => !gsUtils.isSpecialTab(tab) && gsUtils.isSuspendedTab(tab, true)
    );
    if (currentSessionSuspendedTabs.length > 0) {
      gsUtils.log(
        'gsSession',
        'Aborting tab recovery. Browser has open suspended tabs.' +
        ' Assuming user has "On start-up -> Continue where you left off" set' +
        ' or is restarting with suspended pinned tabs.'
      );
      return false;
    }

    const lastSession = await gsIndexedDb.fetchLastSession();
    if (!lastSession) {
      gsUtils.log(
        'gsSession',
        'Aborting tab recovery. Could not find last session.'
      );
      return false;
    }
    gsUtils.log('gsSession', 'lastSession: ', lastSession);

    const lastSessionTabs = lastSession.windows.reduce((a, o) => a.concat(o.tabs), []);
    const expectedPostExtensionCrashTabs = lastSessionTabs.filter(o => o.url.indexOf(chrome.runtime.id) === -1);
    const matchingTabIdsCount = currentSessionTabs.reduce((a, o) => expectedPostExtensionCrashTabs.some(p => p.id === o.id) ? a + 1 : a, 0);
    const maxTabCount = Math.max(expectedPostExtensionCrashTabs.length, currentSessionTabs.length);
    gsUtils.log('gsSession',
      matchingTabIdsCount + ' / ' + maxTabCount +
      ' tabs have the same id between the last session and the current session.'
    );
    if (maxTabCount - matchingTabIdsCount > 1) {
      gsUtils.log(
        'gsSession',
        'Aborting tab recovery. Tab IDs do not match.'
      );
      return false;
    }
    return true;
  }

  async function queueTabInitialisation(tab, timeout, totalTimeQueued) {
    totalTimeQueued = totalTimeQueued || 0;
    if (gsUtils.isSpecialTab(tab)) {
      gsUtils.log(tab.id, 'Ignoring check for special tab.');
      return;
    }
    if (totalTimeQueued >= initTimeoutInSeconds * 1000) {
      gsUtils.warning(
        tab.id,
        `Failed to initialize tab. Tab may not behave as expected.`
      );
      return;
    }
    await gsUtils.setTimeout(timeout);

    let _tab = await fetchUpdatedTab(tab);
    if (!_tab) {
      gsUtils.warning(
        tab.id,
        `Failed to initialize tab. Tab may have been removed.`
      );
      return;
    }

    tab = _tab;
    totalTimeQueued += timeout;
    gsUtils.log(
      tab.id,
      `${parseInt(
        totalTimeQueued / 1000
      )} seconds has elapsed. Pinging tab with state: ${tab.status}..`
    );
    const tabInitialised = await initialiseTab(tab, totalTimeQueued);
    if (!tabInitialised) {
      const nextTimeout = getRandomTimeoutInMilliseconds(5000);
      gsUtils.log(
        tab.id,
        `Tab has still not initialised after ${totalTimeQueued /
          1000}. Re-queuing in another ${nextTimeout / 1000} seconds.`
      );
      await queueTabInitialisation(tab, nextTimeout, totalTimeQueued);
    }
  }

  async function fetchUpdatedTab(tab) {
    const newTab = await gsChrome.tabsGet(tab.id);
    if (newTab) {
      return newTab;
    }
    gsUtils.log(tab.id, 'Failed to get tab. It may have been discarded.');
    const discardedTab = await findPotentialDiscardedTab(tab);
    if (!discardedTab) {
      return null;
    }
    return discardedTab;
  }

  async function findPotentialDiscardedTab(tab) {
    // NOTE: For some reason querying by url doesn't work here??
    // TODO: Report chrome bug
    let tabs = await gsChrome.tabsQuery({
          discarded: true,
          windowId: tab.windowId,
        });
    tabs = tabs.filter(o => o.url === tab.url);
    gsUtils.log('gsSession', 'Searching for discarded tab matching tab: ', tab);
    let matchingTab = null;
    if (tabs.length === 1) {
      matchingTab = tabs[0];
    } else if (tabs.length > 1) {
      matchingTab = tabs.find(o => o.index === tab.index);
      matchingTab = matchingTab || tabs[0];
    }
    if (matchingTab) {
      gsUtils.log('gsSession', 'Potential discarded tabs: ', tabs);
      gsUtils.log(tab.id, 'Updating tab with discarded version: ' + matchingTab.id);
      return matchingTab;
    } else {
      gsUtils.log('gsSession', 'Could not find any potential matching discarded tabs.');
      return null;
    }
  }

  async function initialiseTab(tab, totalTimeQueued) {
    // If tab has a state of loading, then requeue for checking later
    if (tab.status === 'loading') {
      gsUtils.log(tab.id, 'Tab is still loading');
      return false;
    }

    const isDiscardedTab = gsUtils.isDiscardedTab(tab);
    const isSuspendedTab = gsUtils.isSuspendedTab(tab);

    if (isDiscardedTab) {
      if (isSuspendedTab) {
        // If suspended tab has been discarded before init then it may stay in 'blockhead' state
        // Therefore we want to reload this tab to make sure it can be suspended properly
        gsUtils.warning(
          tab.id,
          `Suspended tab was discarded before init. Will reload discarded tab..`
        );
        await gsChrome.tabsUpdate(tab.id, { url: tab.url });
      } else {
        gsUtils.log(tab.id, 'Tab has been discarded.');
        gsSuspendManager.handleDiscardedUnsuspendedTab(tab, true);
      }
      return false; // put it back in the tab check queue
    }

    let tabResponse = await new Promise(resolve => {
      gsMessages.sendPingToTab(tab.id, function(error, _response) {
        if (error) {
          if (isSuspendedTab) {
            gsUtils.log(tab.id, 'Failed to sendPingToTab to suspended tab', error);
          } else {
            gsUtils.log(tab.id, 'Failed to sendPingToTab to unsuspended tab', error);
          }
        }
        resolve(_response);
      });
    });

    if (!tabResponse) {
      // It seems that if you use 'Continue where you left off' that any discarded
      // tabs from the last session will be restored as discarded, but they will not
      // have .discarded = false. This will cause ping and reinjection to fail
      // TODO: Report chrome bug

      // If it is a suspended tab then try reloading the tab and requeue for checking later
      if (isSuspendedTab) {
        requestReloadSuspendedTab(tab);
        return false;
      }

      // If it is a normal tab then first try to reinject content script
      const result = await reinjectContentScriptOnTab(tab);
      if (!result) {
        gsUtils.warning(tab.id, 'Assuming tab has been discarded.');
        gsSuspendManager.handleDiscardedUnsuspendedTab(tab, true);
        return false; // put it back in the tab check queue
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
      return false;
    }

    // If tab returned a response but is not initialised, then try to initialise
    let initialisationResponse;
    if (!tabResponse.isInitialised) {
      try {
        if (isSuspendedTab) {
          initialisationResponse = await tgs.initialiseSuspendedTabAsPromised(tab);
        } else {
          initialisationResponse = await tgs.initialiseUnsuspendedTabAsPromised(tab);
        }
      } catch (error) {
        gsUtils.warning(tab.id, 'Failed to initialiseTabAsPromised', error);
      }
    }

    if (!initialisationResponse || !initialisationResponse.isInitialised) {
      return false;
    }

    // Tab has initialised successfully
    // If tab is suspended and discard after suspend is true, then also discard here
    const discardAfterSuspend = gsStorage.getOption(
      gsStorage.DISCARD_AFTER_SUSPEND
    );
    if (discardAfterSuspend && isSuspendedTab) {
      gsSuspendManager.forceTabDiscardation(tab);
    }
    return true;
  }

  function requestReloadSuspendedTab(tab) {
    // resuspend unresponsive suspended tabs
    gsUtils.log(tab.id, 'Resuspending unresponsive suspended tab.');
    tgs.setTabFlagForTabId(tab.id, tgs.UNSUSPEND_ON_RELOAD_URL, null);
    chrome.tabs.reload(tab.id, function() {
      // Ignore callback here as we need to wait for the suspended tab
      // to finish reloading before we can check again
    });
  }

  async function reinjectContentScriptOnTab(tab) {
    return new Promise(resolve => {
      gsUtils.log(
        tab.id,
        'Reinjecting contentscript into unresponsive active tab.'
      );
      gsMessages.executeScriptOnTab(tab.id, 'js/contentscript.js', error => {
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

  async function recoverLostTabs() {
    const lastSession = await gsIndexedDb.fetchLastSession();
    if (!lastSession) {
      return;
    }

    const recoveryStartTime = Date.now();
    gsUtils.log(
      'gsSession',
      '\n\n------------------------------------------------\n' +
        'Recovery mode started.\n' +
        '------------------------------------------------\n\n'
    );
    gsUtils.log('gsSession', 'lastSession: ', lastSession);
    gsUtils.removeInternalUrlsFromSession(lastSession);

    const currentWindows = await gsChrome.windowsGetAll();
    var matchedCurrentWindowBySessionWindowId = matchCurrentWindowsWithLastSessionWindows(
      lastSession.windows,
      currentWindows
    );

    //attempt to automatically restore any lost tabs/windows in their proper positions
    const lastFocusedWindow = await gsChrome.windowsGetLastFocused();
    const lastFocusedWindowId = lastFocusedWindow ? lastFocusedWindow.id : null;
    for (var sessionWindow of lastSession.windows) {
      var matchedCurrentWindow =
        matchedCurrentWindowBySessionWindowId[sessionWindow.id];
      await restoreSessionWindow(sessionWindow, matchedCurrentWindow, 0);
    }
    if (lastFocusedWindowId) {
      await gsChrome.windowsUpdate(lastFocusedWindowId, { focused: true });
    }

    startupRecoveryTimeTakenInSeconds = parseInt(
      (Date.now() - recoveryStartTime) / 1000
    );
    gsUtils.log(
      'gsSession',
      '\n\n------------------------------------------------\n' +
        'Recovery mode finished. Time taken: ' +
        startupRecoveryTimeTakenInSeconds +
        ' sec\n' +
        '------------------------------------------------\n\n'
    );
    gsUtils.log('gsSession', 'updating current session');
    updateCurrentSession(); //async
  }

  //try to match session windows with currently open windows
  function matchCurrentWindowsWithLastSessionWindows(
    unmatchedSessionWindows,
    unmatchedCurrentWindows
  ) {
    var matchedCurrentWindowBySessionWindowId = {};

    //if there is a current window open that matches the id of the session window id then match it
    unmatchedSessionWindows.slice().forEach(function(sessionWindow) {
      var matchingCurrentWindow = unmatchedCurrentWindows.find(function(
        window
      ) {
        return window.id === sessionWindow.id;
      });
      if (matchingCurrentWindow) {
        matchedCurrentWindowBySessionWindowId[
          sessionWindow.id
        ] = matchingCurrentWindow;
        //remove from unmatchedSessionWindows and unmatchedCurrentWindows
        unmatchedSessionWindows = unmatchedSessionWindows.filter(function(
          window
        ) {
          return window.id !== sessionWindow.id;
        });
        unmatchedCurrentWindows = unmatchedCurrentWindows.filter(function(
          window
        ) {
          return window.id !== matchingCurrentWindow.id;
        });
      }
    });

    if (
      unmatchedSessionWindows.length === 0 ||
      unmatchedCurrentWindows.length === 0
    ) {
      return matchedCurrentWindowBySessionWindowId;
    }

    //if we still have session windows that haven't been matched to a current window then attempt matching based on tab urls
    var tabMatchingObjects = generateTabMatchingObjects(
      unmatchedSessionWindows,
      unmatchedCurrentWindows
    );

    //find the tab matching objects with the highest tabMatchCounts
    while (
      unmatchedSessionWindows.length > 0 &&
      unmatchedCurrentWindows.length > 0
    ) {
      var maxTabMatchCount = Math.max(
        ...tabMatchingObjects.map(function(o) {
          return o.tabMatchCount;
        })
      );
      var bestTabMatchingObject = tabMatchingObjects.find(function(o) {
        return o.tabMatchCount === maxTabMatchCount;
      });

      matchedCurrentWindowBySessionWindowId[
        bestTabMatchingObject.sessionWindow.id
      ] =
        bestTabMatchingObject.currentWindow;

      //remove from unmatchedSessionWindows and unmatchedCurrentWindows
      var unmatchedSessionWindowsLengthBefore = unmatchedSessionWindows.length;
      unmatchedSessionWindows = unmatchedSessionWindows.filter(function(
        window
      ) {
        return window.id !== bestTabMatchingObject.sessionWindow.id;
      });
      unmatchedCurrentWindows = unmatchedCurrentWindows.filter(function(
        window
      ) {
        return window.id !== bestTabMatchingObject.currentWindow.id;
      });
      gsUtils.log(
        'gsUtils',
        'Matched with tab count of ' + maxTabMatchCount + ': ',
        bestTabMatchingObject.sessionWindow,
        bestTabMatchingObject.currentWindow
      );

      //remove from tabMatchingObjects
      tabMatchingObjects = tabMatchingObjects.filter(function(o) {
        return (
          (o.sessionWindow !== bestTabMatchingObject.sessionWindow) &
          (o.currentWindow !== bestTabMatchingObject.currentWindow)
        );
      });

      //safety check to make sure we dont get stuck in infinite loop. should never happen though.
      if (
        unmatchedSessionWindows.length >= unmatchedSessionWindowsLengthBefore
      ) {
        break;
      }
    }

    return matchedCurrentWindowBySessionWindowId;
  }

  function generateTabMatchingObjects(sessionWindows, currentWindows) {
    var unsuspendedSessionUrlsByWindowId = {};
    sessionWindows.forEach(function(sessionWindow) {
      unsuspendedSessionUrlsByWindowId[sessionWindow.id] = [];
      sessionWindow.tabs.forEach(function(curTab) {
        if (!gsUtils.isSpecialTab(curTab) && !gsUtils.isSuspendedTab(curTab)) {
          unsuspendedSessionUrlsByWindowId[sessionWindow.id].push(curTab.url);
        }
      });
    });
    var unsuspendedCurrentUrlsByWindowId = {};
    currentWindows.forEach(function(currentWindow) {
      unsuspendedCurrentUrlsByWindowId[currentWindow.id] = [];
      currentWindow.tabs.forEach(function(curTab) {
        if (!gsUtils.isSpecialTab(curTab) && !gsUtils.isSuspendedTab(curTab)) {
          unsuspendedCurrentUrlsByWindowId[currentWindow.id].push(curTab.url);
        }
      });
    });

    var tabMatchingObjects = [];
    sessionWindows.forEach(function(sessionWindow) {
      currentWindows.forEach(function(currentWindow) {
        var unsuspendedSessionUrls =
          unsuspendedSessionUrlsByWindowId[sessionWindow.id];
        var unsuspendedCurrentUrls =
          unsuspendedCurrentUrlsByWindowId[currentWindow.id];
        var matchCount = unsuspendedCurrentUrls.filter(function(url) {
          return unsuspendedSessionUrls.includes(url);
        }).length;
        tabMatchingObjects.push({
          tabMatchCount: matchCount,
          sessionWindow: sessionWindow,
          currentWindow: currentWindow,
        });
      });
    });

    return tabMatchingObjects;
  }

  // suspendMode controls whether the tabs are restored as suspended or unsuspended
  // 0: Leave the urls as they are (suspended stay suspended, ussuspended stay unsuspended)
  // 1: Open all unsuspended tabs as suspended
  // 2: Open all suspended tabs as unsuspended
  async function restoreSessionWindow(
    sessionWindow,
    existingWindow,
    suspendMode
  ) {
    if (sessionWindow.tabs.length === 0) {
      gsUtils.log('gsUtils', 'SessionWindow contains no tabs to restore');
    }

    // if we have been provided with a current window to recover into
    if (existingWindow) {
      gsUtils.log(
        'gsUtils',
        'Matched sessionWindow with existingWindow: ',
        sessionWindow,
        existingWindow
      );
      const currentTabIds = [];
      const currentTabUrls = [];
      const tabPromises = [];
      for (const currentTab of existingWindow.tabs) {
        currentTabIds.push(currentTab.id);
        currentTabUrls.push(currentTab.url);
      }

      for (const sessionTab of sessionWindow.tabs) {
        //if current tab does not exist then recreate it
        if (
          !gsUtils.isSpecialTab(sessionTab) &&
          !currentTabUrls.includes(sessionTab.url) &&
          !currentTabIds.includes(sessionTab.id)
        ) {
          tabPromises.push(
            createNewTabFromSessionTab(
              sessionTab,
              existingWindow.id,
              suspendMode
            )
          );
        }
      }
      await Promise.all(tabPromises);
      return;
    }

    // else restore entire window
    gsUtils.log(
      'gsUtils',
      'Could not find match for sessionWindow: ',
      sessionWindow
    );

    const restoringUrl = chrome.extension.getURL('restoring-window.html');
    // Create new window. Important: do not pass in all urls to chrome.windows.create
    // If you load too many windows (or tabs?) like this, then it seems to blow
    // out the GPU memory in the chrome task manager
    // TODO: Report chrome bug
    const newWindow = await gsUtils.createWindowAndWaitForFinishLoading(
      { url: restoringUrl, focused: false },
      500 // dont actually wait
    );
    const placeholderTab = newWindow.tabs[0];
    const tabPromises = [];
    for (const sessionTab of sessionWindow.tabs) {
      tabPromises.push(
        createNewTabFromSessionTab(sessionTab, newWindow.id, suspendMode)
      );
    }
    await Promise.all(tabPromises);
    if (placeholderTab) {
      await gsChrome.tabsRemove(placeholderTab.id);
    }
  }

  async function createNewTabFromSessionTab(sessionTab, windowId, suspendMode) {
    let url = sessionTab.url;
    if (
      suspendMode === 1 &&
      !gsUtils.isSuspendedTab(sessionTab) &&
      !gsUtils.isSpecialTab(sessionTab)
    ) {
      url = gsUtils.generateSuspendedUrl(sessionTab.url, sessionTab.title);
    } else if (suspendMode === 2 && gsUtils.isSuspendedTab(sessionTab)) {
      url = gsUtils.getSuspendedUrl(sessionTab.url);
    }
    const newTab = await gsChrome.tabsCreate({
      windowId: windowId,
      url: url,
      index: sessionTab.index,
      pinned: sessionTab.pinned,
      active: false,
    });

    // Update recovery view (if it exists)
    if (recoveryTabId) {
      gsMessages.sendTabInfoToRecoveryTab(recoveryTabId, newTab); //async. unhandled error
    }
  }

  async function updateSessionMetrics(reset) {
    reset = reset || false;

    const tabs = await gsChrome.tabsQuery();
    let curSuspendedTabCount = 0;
    for (let tab of tabs) {
      if (gsUtils.isSuspendedTab(tab, true)) {
        curSuspendedTabCount += 1;
      }
    }
    let sessionMetrics;
    if (reset) {
      gsUtils.log('gsSession', 'Resetting session metrics');
    } else {
      sessionMetrics = gsStorage.fetchSessionMetrics();
    }

    // If no session metrics exist then create a new one
    if (!sessionMetrics || !sessionMetrics[gsStorage.SM_TIMESTAMP]) {
      sessionMetrics = createNewSessionMetrics(
        curSuspendedTabCount,
        tabs.length
      );
      gsStorage.setSessionMetrics(sessionMetrics);
      gsUtils.log('gsSession', 'Created new session metrics', sessionMetrics);
      return;
    }

    // Else update metrics (if new max reached)
    const lastSuspendedTabCount =
      sessionMetrics[gsStorage.SM_SUSPENDED_TAB_COUNT];
    if (lastSuspendedTabCount < curSuspendedTabCount) {
      sessionMetrics[gsStorage.SM_SUSPENDED_TAB_COUNT] = curSuspendedTabCount;
      sessionMetrics[gsStorage.SM_TOTAL_TAB_COUNT] = tabs.length;
      gsStorage.setSessionMetrics(sessionMetrics);
      gsUtils.log('gsSession', 'Updated session metrics', sessionMetrics);
    }
  }

  function createNewSessionMetrics(suspendedTabCount, totalTabCount) {
    const sessionMetrics = {
      [gsStorage.SM_TIMESTAMP]: Date.now(),
      [gsStorage.SM_SUSPENDED_TAB_COUNT]: suspendedTabCount,
      [gsStorage.SM_TOTAL_TAB_COUNT]: totalTabCount,
    };
    return sessionMetrics;
  }

  return {
    initAsPromised,
    runStartupChecks,
    getSessionId,
    buildCurrentSession,
    updateCurrentSession,
    isInitialising,
    isUpdated,
    getTabCheckTimeTakenInSeconds,
    getRecoveryTimeTakenInSeconds,
    getStartupType,
    getStartupLastVersion,
    recoverLostTabs,
    checkTabsForResponsiveness,
    restoreSessionWindow,
    prepareForUpdate,
    getUpdateType,
    updateSessionMetrics,
  };
})();
