/*global chrome, localStorage, tgs, gsStorage, gsIndexedDb, gsUtils, gsChrome, gsTabCheckManager, gsTabDiscardManager */
// eslint-disable-next-line no-unused-vars
var gsSession = (function() {
  'use strict';

  const tabsToRestorePerSecond = 12;

  let updatedUrl;

  let initialisationMode = true;
  let sessionId;
  let updateType = null;
  let updated = false;
  let fileUrlsAccessAllowed = false;

  let startupTabCheckTimeTakenInSeconds;
  let startupRecoveryTimeTakenInSeconds;
  let startupType;
  let startupLastVersion;
  let syncedSettingsOnInit;

  async function initAsPromised() {
    updatedUrl = chrome.extension.getURL('updated.html');

    // Set fileUrlsAccessAllowed to determine if extension can work on file:// URLs
    await new Promise(r => {
      chrome.extension.isAllowedFileSchemeAccess(isAllowedAccess => {
        fileUrlsAccessAllowed = isAllowedAccess;
        r();
      });
    });

    //remove any update screens
    await Promise.all([
      gsUtils.removeTabsByUrlAsPromised(updatedUrl),
    ]);

    //handle special event where an extension update is available
    chrome.runtime.onUpdateAvailable.addListener(details => {
      prepareForUpdate(details); //async
    });
    gsUtils.log('gsSession', 'init successful');
  }

  async function prepareForUpdate(newVersionDetails) {
    const currentVersion = chrome.runtime.getManifest().version;
    const newVersion = newVersionDetails.version;

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
    if (suspendedTabCount === 0) {
      // if there are no suspended tabs then simply install the update immediately
      chrome.runtime.reload();
    } else {
      //do nothing. this prevents chrome from automatically updating and will instead wait
      //until a browser restart to update
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
    const tabsExist = currentWindows.some(
      window => window.tabs && window.tabs.length
    );
    if (!tabsExist) {
      gsUtils.warning(
        'gsSession',
        'Failed to build current session. Could not find any tabs.'
      );
      return null;
    }
    const currentSession = {
      sessionId: getSessionId(),
      windows: currentWindows,
      date: new Date().toISOString(),
    };
    return currentSession;
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

  function isFileUrlsAccessAllowed() {
    return fileUrlsAccessAllowed;
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

  function setSynchedSettingsOnInit(syncedSettings) {
    syncedSettingsOnInit = syncedSettings;
  }

  async function runStartupChecks() {
    initialisationMode = true;

    const currentSessionTabs = await gsChrome.tabsQuery();
    gsUtils.log('gsSession', 'preRecovery open tabs:', currentSessionTabs);

    const curVersion = chrome.runtime.getManifest().version;
    gsUtils.log('gsSession', 'curVersion:', curVersion);

    startupLastVersion = gsStorage.fetchLastVersion();
    gsUtils.log('gsSession', 'startupLastVersion:', startupLastVersion);

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

    await performTabChecks();

    // Ensure currently focused tab is initialised correctly if suspended
    const currentWindowActiveTabs = await gsChrome.tabsQuery({
      active: true,
      currentWindow: true,
    });
    if (currentWindowActiveTabs.length > 0) {
      gsTabCheckManager.queueTabCheck(currentWindowActiveTabs[0]);
    }

    gsUtils.log('gsSession', 'updating current session');
    updateCurrentSession(); //async

    initialisationMode = false;
  }

  //make sure the contentscript / suspended script of each tab is responsive
  async function performTabChecks() {
    const initStartTime = Date.now();
    gsUtils.log(
      'gsSession',
      '\n\n------------------------------------------------\n' +
        `Checking tabs for responsiveness..\n` +
        '------------------------------------------------\n\n'
    );

    const postRecoverySessionTabs = await gsChrome.tabsQuery();
    gsUtils.log(
      'gsSession',
      'postRecoverySessionTabs:',
      postRecoverySessionTabs
    );

    const tabCheckResults = await gsTabCheckManager.performInitialisationTabChecks(
      postRecoverySessionTabs
    );
    const totalTabCheckCount = tabCheckResults.length;
    const successfulTabChecksCount = tabCheckResults.filter(
      o => o === gsUtils.STATUS_SUSPENDED || o === gsUtils.STATUS_DISCARDED
    ).length;

    startupTabCheckTimeTakenInSeconds = parseInt(
      (Date.now() - initStartTime) / 1000
    );
    gsUtils.log(
      'gsSession',
      '\n\n------------------------------------------------\n' +
        `Checking tabs finished. Time taken: ${startupTabCheckTimeTakenInSeconds} sec\n` +
        `${successfulTabChecksCount} / ${totalTabCheckCount} initialised successfully\n` +
        '------------------------------------------------\n\n'
    );
  }

  async function handleNormalStartup(currentSessionTabs, curVersion) {
    const shouldRecoverTabs = await checkForCrashRecovery(currentSessionTabs);
    if (shouldRecoverTabs) {
      const lastExtensionRecoveryTimestamp = gsStorage.fetchLastExtensionRecoveryTimestamp();
      const hasCrashedRecently =
        lastExtensionRecoveryTimestamp &&
        Date.now() - lastExtensionRecoveryTimestamp < 1000 * 60 * 5;
      gsStorage.setLastExtensionRecoveryTimestamp(Date.now());

      if (!hasCrashedRecently) {
        //if this is the first recent crash, then automatically recover lost tabs
        await recoverLostTabs();
      } else {
        //otherwise show the recovery page
        const recoveryUrl = chrome.extension.getURL('recovery.html');
        await gsChrome.tabsCreate(recoveryUrl);
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

    // Try to determine if this is a new install for the computer or for the whole profile
    // If settings sync contains non-default options, then we can assume it's only
    // a new install for this computer
    if (
      !syncedSettingsOnInit ||
      Object.keys(syncedSettingsOnInit).length === 0
    ) {
      //show welcome message
      const optionsUrl = chrome.extension.getURL('options.html?firstTime');
      const noNag = gsStorage.getOption(gsStorage.NO_NAG);
      if (!noNag) {
        await gsChrome.tabsCreate(optionsUrl);
      }
    }
  }

  async function handleUpdate(currentSessionTabs, curVersion, lastVersion) {
    gsStorage.setLastVersion(curVersion);
    const lastVersionParts = lastVersion.split('.');
    const curVersionParts = curVersion.split('.');
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

    await gsUtils.removeTabsByUrlAsPromised(updatedUrl);

    await gsIndexedDb.performMigration(lastVersion);
    gsStorage.setNoticeVersion('0');
    const noNag = gsStorage.getOption(gsStorage.NO_NAG);
    const shouldRecoverTabs = await checkForCrashRecovery(currentSessionTabs);
    if (shouldRecoverTabs) {
      if (!noNag) {
        await gsUtils.createTabAndWaitForFinishLoading(updatedUrl, 10000);
      }  

      await recoverLostTabs();
      updated = true;

      //update updated views
      const updatedViews = tgs.getInternalViewsByViewName('updated');
      if (updatedViews.length > 0) {
        for (const view of updatedViews) {
          view.exports.toggleUpdated();
        }
      } else {
        await gsUtils.removeTabsByUrlAsPromised(updatedUrl);
        if (!noNag) {
          await gsChrome.tabsCreate({ url: updatedUrl });
        }  
      }
    } else {
      updated = true;
      if (!noNag) {
        await gsChrome.tabsCreate({ url: updatedUrl });
      }  
    }
  }

  // This function is used only for testing
  async function triggerDiscardOfAllTabs() {
    await new Promise(resolve => {
      chrome.tabs.query({ active: false, discarded: false }, function(tabs) {
        for (let i = 0; i < tabs.length; ++i) {
          if (tabs[i] === undefined || gsUtils.isSpecialTab(tabs[i])) {
            continue;
          }
          gsTabDiscardManager.queueTabForDiscard(tabs[i]);
        }
        resolve();
      });
    });
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
      tab => !gsUtils.isSpecialTab(tab) && gsUtils.isSuspendedTab(tab)
    );
    const currentSessionNonExtensionTabs = currentSessionTabs.filter(
      o => o.url.indexOf(chrome.runtime.id) === -1
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

    const lastSessionTabs = lastSession.windows.reduce(
      (a, o) => a.concat(o.tabs),
      []
    );
    const lastSessionSuspendedTabs = lastSessionTabs.filter(o =>
      gsUtils.isSuspendedTab(o)
    );
    const lastSessionNonExtensionTabs = lastSessionTabs.filter(
      o => o.url.indexOf(chrome.runtime.id) === -1
    );

    if (lastSessionSuspendedTabs.length === 0) {
      gsUtils.log(
        'gsSession',
        'Aborting tab recovery. Last session contained no suspended tabs.'
      );
      return false;
    }

    // Match against all tabIds from last session here, not just non-extension tabs
    // as there is a chance during tabInitialisation of a suspended tab getting reloaded
    // directly and hence keeping its tabId (ie: file:// tabs)
    function matchingTabExists(tab) {
      if (tab.url.indexOf('chrome://newtab') === 0 && tab.index === 0)
        return false;
      return lastSessionTabs.some(o => o.id === tab.id && o.url === tab.url);
    }
    const matchingTabIdsCount = currentSessionNonExtensionTabs.reduce(
      (a, o) => (matchingTabExists(o) ? a + 1 : a),
      0
    );
    const maxMatchableTabsCount = Math.max(
      lastSessionNonExtensionTabs.length,
      currentSessionNonExtensionTabs.length
    );
    gsUtils.log(
      'gsSession',
      matchingTabIdsCount +
        ' / ' +
        maxMatchableTabsCount +
        ' tabs have the same id between the last session and the current session.'
    );
    if (
      matchingTabIdsCount === 0 ||
      maxMatchableTabsCount - matchingTabIdsCount > 1
    ) {
      gsUtils.log('gsSession', 'Aborting tab recovery. Tab IDs do not match.');
      return false;
    }

    return true;
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
    const matchedCurrentWindowBySessionWindowId = matchCurrentWindowsWithLastSessionWindows(
      lastSession.windows,
      currentWindows
    );

    //attempt to automatically restore any lost tabs/windows in their proper positions
    const lastFocusedWindow = await gsChrome.windowsGetLastFocused();
    const lastFocusedWindowId = lastFocusedWindow ? lastFocusedWindow.id : null;
    for (let sessionWindow of lastSession.windows) {
      const matchedCurrentWindow =
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
    const matchedCurrentWindowBySessionWindowId = {};

    //if there is a current window open that matches the id of the session window id then match it
    unmatchedSessionWindows.slice().forEach(function(sessionWindow) {
      const matchingCurrentWindow = unmatchedCurrentWindows.find(function(
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
    let tabMatchingObjects = generateTabMatchingObjects(
      unmatchedSessionWindows,
      unmatchedCurrentWindows
    );

    //find the tab matching objects with the highest tabMatchCounts
    while (
      unmatchedSessionWindows.length > 0 &&
      unmatchedCurrentWindows.length > 0
    ) {
      const maxTabMatchCount = Math.max(
        ...tabMatchingObjects.map(function(o) {
          return o.tabMatchCount;
        })
      );
      const bestTabMatchingObject = tabMatchingObjects.find(function(o) {
        return o.tabMatchCount === maxTabMatchCount;
      });

      matchedCurrentWindowBySessionWindowId[
        bestTabMatchingObject.sessionWindow.id
      ] =
        bestTabMatchingObject.currentWindow;

      //remove from unmatchedSessionWindows and unmatchedCurrentWindows
      const unmatchedSessionWindowsLengthBefore =
        unmatchedSessionWindows.length;
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
    const unsuspendedSessionUrlsByWindowId = {};
    sessionWindows.forEach(function(sessionWindow) {
      unsuspendedSessionUrlsByWindowId[sessionWindow.id] = [];
      sessionWindow.tabs.forEach(function(curTab) {
        if (gsUtils.isNormalTab(curTab)) {
          unsuspendedSessionUrlsByWindowId[sessionWindow.id].push(curTab.url);
        }
      });
    });
    const unsuspendedCurrentUrlsByWindowId = {};
    currentWindows.forEach(function(currentWindow) {
      unsuspendedCurrentUrlsByWindowId[currentWindow.id] = [];
      currentWindow.tabs.forEach(function(curTab) {
        if (gsUtils.isNormalTab(curTab)) {
          unsuspendedCurrentUrlsByWindowId[currentWindow.id].push(curTab.url);
        }
      });
    });

    const tabMatchingObjects = [];
    sessionWindows.forEach(function(sessionWindow) {
      currentWindows.forEach(function(currentWindow) {
        const unsuspendedSessionUrls =
          unsuspendedSessionUrlsByWindowId[sessionWindow.id];
        const unsuspendedCurrentUrls =
          unsuspendedCurrentUrlsByWindowId[currentWindow.id];
        const matchCount = unsuspendedCurrentUrls.filter(function(url) {
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

      for (const [i, sessionTab] of sessionWindow.tabs.entries()) {
        //if current tab does not exist then recreate it
        if (
          !gsUtils.isSpecialTab(sessionTab) &&
          !currentTabUrls.includes(sessionTab.url) &&
          !currentTabIds.includes(sessionTab.id)
        ) {
          tabPromises.push(
            new Promise(async resolve => {
              await gsUtils.setTimeout(i * 20);
              // dont await createNewTab as we want them to happen concurrently (but staggered)
              createNewTabFromSessionTab(
                sessionTab,
                existingWindow.id,
                sessionTab.index,
                suspendMode
              );
              resolve();
            })
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
    await gsChrome.tabsUpdate(placeholderTab.id, { pinned: true });

    const tabPromises = [];
    for (const [i, sessionTab] of sessionWindow.tabs.entries()) {
      tabPromises.push(
        new Promise(async resolve => {
          await gsUtils.setTimeout(i * (1000 / tabsToRestorePerSecond));
          // dont await createNewTab as we want them to happen concurrently (but staggered)
          createNewTabFromSessionTab(
            sessionTab,
            newWindow.id,
            i + 1,
            suspendMode
          );
          resolve();
        })
      );
    }
    await Promise.all(tabPromises);
    if (placeholderTab) {
      await gsChrome.tabsRemove(placeholderTab.id);
    }
  }

  async function createNewTabFromSessionTab(
    sessionTab,
    windowId,
    index,
    suspendMode
  ) {
    let url = sessionTab.url;
    if (suspendMode === 1 && gsUtils.isNormalTab(sessionTab)) {
      url = gsUtils.generateSuspendedUrl(sessionTab.url, sessionTab.title);
    } else if (suspendMode === 2 && gsUtils.isSuspendedTab(sessionTab)) {
      url = gsUtils.getOriginalUrl(sessionTab.url);
    }
    const newTab = await gsChrome.tabsCreate({
      windowId: windowId,
      url: url,
      index: index,
      pinned: sessionTab.pinned,
      active: false,
    });

    // Update recovery view (if it exists)
    for (const view of tgs.getInternalViewsByViewName('recovery')) {
      view.exports.removeTabFromList(newTab);
    }
  }

  async function updateSessionMetrics(reset) {
    reset = reset || false;

    const tabs = await gsChrome.tabsQuery();
    let curSuspendedTabCount = 0;
    for (let tab of tabs) {
      if (gsUtils.isSuspendedTab(tab)) {
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
    isFileUrlsAccessAllowed,
    getTabCheckTimeTakenInSeconds,
    getRecoveryTimeTakenInSeconds,
    getStartupType,
    setSynchedSettingsOnInit,
    getStartupLastVersion,
    recoverLostTabs,
    triggerDiscardOfAllTabs,
    restoreSessionWindow,
    prepareForUpdate,
    getUpdateType,
    updateSessionMetrics,
  };
})();
