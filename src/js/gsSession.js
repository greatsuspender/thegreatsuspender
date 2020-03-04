import {
  fetchLastExtensionRecoveryTimestamp,
  setLastExtensionRecoveryTimestamp,
  fetchLastVersion,
  fetchSessionMetrics,
  setSessionMetrics,
  setLastVersion,
  setNoticeVersion,
  SM_TIMESTAMP,
  SM_SUSPENDED_TAB_COUNT,
  SM_TOTAL_TAB_COUNT,
} from './gsStorage';
import {
  createOrUpdateSessionRestorePoint,
  updateSession,
  fetchSessionRestorePoint,
  trimDbItems,
  performMigration,
  fetchLastSession,
} from './gsIndexedDb';
import { generateSuspendUrl } from './actions/suspendTab';
import {
  log,
  warning,
  error,
  removeTabsByUrlAsPromised,
  getSuspendedTabCount,
  isSuspendedTab,
  isSpecialTab,
  isNormalTab,
  getOriginalUrlFromSuspendedUrl,
  createTabAndWaitForFinishLoading,
  removeInternalUrlsFromSession,
  createWindowAndWaitForFinishLoading,
  STATUS_SUSPENDED,
  STATUS_DISCARDED,
} from './gsUtils';
import {
  tabsCreate,
  tabsQuery,
  tabsRemove,
  tabsUpdate,
  windowsUpdate,
  windowsGetAll,
  windowsGetLastFocused,
} from './gsChrome';
import {
  queueTabCheck,
  performInitialisationTabChecks,
} from './gsTabCheckManager';
import {
  executeViewGlobalsForViewName,
  VIEW_FUNC_UPDATED_TOGGLE,
  VIEW_FUNC_RECOVERY_REMOVE_TAB,
} from './gsViews';
import { unsuspendTab } from './gsTgs';

const tabsToRestorePerSecond = 12;

let updateUrl;
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

export const initAsPromised = async () => {
  updateUrl = chrome.runtime.getURL('update.html');
  updatedUrl = chrome.runtime.getURL('updated.html');

  // Set fileUrlsAccessAllowed to determine if extension can work on file:// URLs
  await new Promise(r => {
    chrome.extension.isAllowedFileSchemeAccess(isAllowedAccess => {
      fileUrlsAccessAllowed = isAllowedAccess;
      r();
    });
  });

  //remove any update screens
  await Promise.all([
    removeTabsByUrlAsPromised(updateUrl),
    removeTabsByUrlAsPromised(updatedUrl),
  ]);

  //handle special event where an extension update is available
  chrome.runtime.onUpdateAvailable.addListener(details => {
    prepareForUpdate(details); //async
  });
  log('gsSession', 'init successful');
};

export const prepareForUpdate = async newVersionDetails => {
  const currentVersion = chrome.runtime.getManifest().version;
  const newVersion = newVersionDetails.version;

  log(
    'gsSession',
    'A new version is available: ' + currentVersion + ' -> ' + newVersion
  );

  let sessionRestorePoint;
  const currentSession = await buildCurrentSession();
  if (currentSession) {
    sessionRestorePoint = await createOrUpdateSessionRestorePoint(
      currentSession,
      currentVersion
    );
  }

  const suspendedTabCount = await getSuspendedTabCount();
  if (!sessionRestorePoint || suspendedTabCount > 0) {
    //show update screen
    await tabsCreate(updateUrl);
    //ensure we don't leave any windows with no unsuspended tabs
    await unsuspendActiveTabInEachWindow();
  } else {
    // if there are no suspended tabs then simply install the update immediately
    chrome.runtime.reload();
  }
};

export const getSessionId = () => {
  if (!sessionId) {
    //turn this into a string to make comparisons easier further down the track
    sessionId = Date.now() + '';
    log('gsSession', 'sessionId: ', sessionId);
  }
  return sessionId;
};

export const buildCurrentSession = async () => {
  const currentWindows = await windowsGetAll();
  const tabsExist = currentWindows.some(
    window => window.tabs && window.tabs.length
  );
  if (!tabsExist) {
    warning(
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
};

export const updateCurrentSession = async () => {
  const currentSession = await buildCurrentSession();
  if (currentSession) {
    await updateSession(currentSession);
  }
};

export const isUpdated = () => {
  return updated;
};

export const isInitialising = () => {
  return initialisationMode;
};

export const isFileUrlsAccessAllowed = () => {
  return fileUrlsAccessAllowed;
};

export const getTabCheckTimeTakenInSeconds = () => {
  return startupTabCheckTimeTakenInSeconds;
};

export const getRecoveryTimeTakenInSeconds = () => {
  return startupRecoveryTimeTakenInSeconds;
};

export const getStartupType = () => {
  return startupType;
};

export const getStartupLastVersion = () => {
  return startupLastVersion;
};

export const getUpdateType = () => {
  return updateType;
};

export const setSynchedSettingsOnInit = syncedSettings => {
  syncedSettingsOnInit = syncedSettings;
};

export const runStartupChecks = async () => {
  initialisationMode = true;

  const currentSessionTabs = await tabsQuery();
  log('gsSession', 'preRecovery open tabs:', currentSessionTabs);

  const curVersion = chrome.runtime.getManifest().version;
  log('gsSession', 'curVersion:', curVersion);

  startupLastVersion = fetchLastVersion();
  log('gsSession', 'startupLastVersion:', startupLastVersion);

  if (chrome.extension.inIncognitoContext) {
    // do nothing if in incognito context
    startupType = 'Incognito';
  } else if (startupLastVersion === curVersion) {
    log('gsSession', 'HANDLING NORMAL STARTUP');
    startupType = 'Restart';
    await handleNormalStartup(currentSessionTabs, curVersion);
  } else if (!startupLastVersion || startupLastVersion === '0.0.0') {
    log('gsSession', 'HANDLING NEW INSTALL');
    startupType = 'Install';
    await handleNewInstall(curVersion);
  } else {
    log('gsSession', 'HANDLING UPDATE');
    startupType = 'Update';
    await handleUpdate(currentSessionTabs, curVersion, startupLastVersion);
  }

  //TODO: reinstate this code: await performTabChecks();

  // Ensure currently focused tab is initialised correctly if suspended
  const currentWindowActiveTabs = await tabsQuery({
    active: true,
    currentWindow: true,
  });
  if (currentWindowActiveTabs.length > 0) {
    //TODO: Reenable this check
    // queueTabCheck(currentWindowActiveTabs[0]);
  }

  log('gsSession', 'updating current session');
  updateCurrentSession(); //async

  initialisationMode = false;
};

//make sure the contentscript / suspended script of each tab is responsive
export const performTabChecks = async () => {
  const initStartTime = Date.now();
  log(
    'gsSession',
    '\n\n------------------------------------------------\n' +
      `Checking tabs for responsiveness..\n` +
      '------------------------------------------------\n\n'
  );

  log('tab check skipped for now');
  //TODO: Reenable tab checks?
  // const postRecoverySessionTabs = await tabsQuery();
  // log('gsSession', 'postRecoverySessionTabs:', postRecoverySessionTabs);

  // const tabCheckResults = await performInitialisationTabChecks(
  //   postRecoverySessionTabs
  // );
  // const totalTabCheckCount = tabCheckResults.length;
  // const successfulTabChecksCount = tabCheckResults.filter(
  //   o => o === STATUS_SUSPENDED || o === STATUS_DISCARDED
  // ).length;

  startupTabCheckTimeTakenInSeconds = parseInt(
    (Date.now() - initStartTime) / 1000
  );
  // log(
  //   'gsSession',
  //   '\n\n------------------------------------------------\n' +
  //     `Checking tabs finished. Time taken: ${startupTabCheckTimeTakenInSeconds} sec\n` +
  //     `${successfulTabChecksCount} / ${totalTabCheckCount} initialised successfully\n` +
  //     '------------------------------------------------\n\n'
  // );
};

const setTimeout = timeoutInMs => {
  return new Promise(resolve => {
    window.setTimeout(resolve, timeoutInMs);
  });
};

export const handleNormalStartup = async currentSessionTabs => {
  const shouldRecoverTabs = await checkForCrashRecovery(currentSessionTabs);
  if (shouldRecoverTabs) {
    const lastExtensionRecoveryTimestamp = fetchLastExtensionRecoveryTimestamp();
    const hasCrashedRecently =
      lastExtensionRecoveryTimestamp &&
      Date.now() - lastExtensionRecoveryTimestamp < 1000 * 60 * 5;
    setLastExtensionRecoveryTimestamp(Date.now());

    if (!hasCrashedRecently) {
      //if this is the first recent crash, then automatically recover lost tabs
      await recoverLostTabs();
    } else {
      //otherwise show the recovery page
      const recoveryUrl = chrome.runtime.getURL('recovery.html');
      await tabsCreate(recoveryUrl);
      //hax0r: wait for recovery tab to finish loading before returning
      //this is so we remain in 'recoveryMode' for a bit longer, preventing
      //the sessionUpdate code from running when this tab gains focus
      await setTimeout(2000);
    }
  } else {
    await trimDbItems();
  }
};

export const handleNewInstall = async curVersion => {
  setLastVersion(curVersion);

  // Try to determine if this is a new install for the computer or for the whole profile
  // If settings sync contains non-default options, then we can assume it's only
  // a new install for this computer
  if (!syncedSettingsOnInit || Object.keys(syncedSettingsOnInit).length === 0) {
    //show welcome message
    const optionsUrl = chrome.runtime.getURL('options.html?firstTime');
    await tabsCreate(optionsUrl);
  }
};

export const handleUpdate = async (
  currentSessionTabs,
  curVersion,
  lastVersion
) => {
  setLastVersion(curVersion);
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

  const sessionRestorePoint = await fetchSessionRestorePoint(lastVersion);
  if (!sessionRestorePoint) {
    const lastSession = await fetchLastSession();
    if (lastSession) {
      await createOrUpdateSessionRestorePoint(lastSession, lastVersion);
    } else {
      error(
        'gsSession',
        'No session restore point found, and no lastSession exists!'
      );
    }
  }

  await removeTabsByUrlAsPromised(updateUrl);
  await removeTabsByUrlAsPromised(updatedUrl);

  await performMigration(lastVersion);
  setNoticeVersion('0');
  const shouldRecoverTabs = await checkForCrashRecovery(currentSessionTabs);
  if (shouldRecoverTabs) {
    await createTabAndWaitForFinishLoading(updatedUrl, 10000);

    await recoverLostTabs();
    updated = true;

    //update updated views
    const updatedViews = executeViewGlobalsForViewName(
      'updated',
      VIEW_FUNC_UPDATED_TOGGLE
    );
    if (updatedViews.length === 0) {
      await removeTabsByUrlAsPromised(updatedUrl);
      await tabsCreate({ url: updatedUrl });
    }
  } else {
    updated = true;
    await tabsCreate({ url: updatedUrl });
  }
};

// This function is used only for testing
export const triggerDiscardOfAllTabs = async () => {
  await new Promise(resolve => {
    chrome.tabs.query({ active: false, discarded: false }, function(tabs) {
      for (let i = 0; i < tabs.length; ++i) {
        if (tabs[i] === undefined || isSpecialTab(tabs[i])) {
          continue;
        }
        chrome.tabs.discard(tabs[i].id);
      }
      resolve();
    });
  });
};

export const checkForCrashRecovery = async currentSessionTabs => {
  log('gsSession', 'Checking for crash recovery: ' + new Date().toISOString());

  const lastSession = await fetchLastSession();
  if (!lastSession) {
    log('gsSession', 'Aborting tab recovery. Could not find last session.');
    return false;
  }
  log('gsSession', 'lastSession: ', lastSession);

  const lastSessionTabs = lastSession.windows.reduce(
    (a, o) => a.concat(o.tabs),
    []
  );

  // Check tabs from this session with tabs from last session. If some of them match both
  // tabId and URL, then assume we have just undergone an extension crash
  const matchingTabFound = currentSessionTabs.some(curTab => {
    if (curTab.url.indexOf('chrome://newtab') === 0 && curTab.index === 0)
      return false;
    return lastSessionTabs.some(
      oldTab => oldTab.id === curTab.id && oldTab.url === curTab.url
    );
  });

  if (!matchingTabFound) {
    log('gsSession', 'Aborting tab recovery. Tab IDs do not match.');
    return false;
  }

  const missingSuspendedTabs = lastSessionTabs.filter(oldTab => {
    if (!isSuspendedTab(oldTab)) return false;
    return !currentSessionTabs.some(curTab => oldTab.url === curTab.url);
  });

  if (missingSuspendedTabs.length === 0) {
    log('gsSession', 'Aborting tab recovery. No missing suspended tabs found.');
    return false;
  }

  log(
    'gsSession',
    'Initiating tab recovery. Found the following missing suspended tabs: ',
    missingSuspendedTabs
  );
  return true;

  // const matchingNonExtensionTabCount = currentSessionNonExtensionTabs.reduce(
  //   (a, o) => (matchingTabExists(o) ? a + 1 : a),
  //   0
  // );
  // const maxNonExtensionTabsCount = Math.max(
  //   lastSessionNonExtensionTabs.length,
  //   currentSessionNonExtensionTabs.length
  // );

  // //try to detect whether the extension has crashed as apposed to chrome restarting
  // //if it is an extension crash, then in theory all suspended tabs will be gone
  // //and all normal tabs will still exist with the same ids
  // const currentSessionSuspendedTabs = currentSessionTabs.filter(
  //   tab => !isSpecialTab(tab) && isSuspendedTab(tab)
  // );
  // const currentSessionNonExtensionTabs = currentSessionTabs.filter(
  //   tab => tab.url.indexOf(chrome.runtime.id) === -1 && !isSuspendedTab(tab)
  // );

  // //TODO: Reenable this startup check?
  // // if (currentSessionSuspendedTabs.length > 0) {
  // //   log(
  // //     'gsSession',
  // //     'Aborting tab recovery. Browser has open suspended tabs.' +
  // //       ' Assuming user has "On start-up -> Continue where you left off" set' +
  // //       ' or is restarting with suspended pinned tabs.'
  // //   );
  // //   return false;
  // // }

  // const lastSession = await fetchLastSession();
  // if (!lastSession) {
  //   log('gsSession', 'Aborting tab recovery. Could not find last session.');
  //   return false;
  // }
  // log('gsSession', 'lastSession: ', lastSession);

  // const lastSessionTabs = lastSession.windows.reduce(
  //   (a, o) => a.concat(o.tabs),
  //   []
  // );
  // const lastSessionSuspendedTabs = lastSessionTabs.filter(o =>
  //   isSuspendedTab(o)
  // );
  // const lastSessionNonExtensionTabs = lastSessionTabs.filter(
  //   tab => tab.url.indexOf(chrome.runtime.id) === -1 && !isSuspendedTab(tab)
  // );

  // if (lastSessionSuspendedTabs.length === 0) {
  //   log(
  //     'gsSession',
  //     'Aborting tab recovery. Last session contained no suspended tabs.'
  //   );
  //   return false;
  // }

  // // Match against all tabIds from last session here, not just non-extension tabs
  // // as there is a chance during tabInitialisation of a suspended tab getting reloaded
  // // directly and hence keeping its tabId (ie: file:// tabs)
  // const matchingTabExists = tab => {
  //   if (tab.url.indexOf('chrome://newtab') === 0 && tab.index === 0)
  //     return false;
  //   return lastSessionTabs.some(o => o.id === tab.id && o.url === tab.url);
  // };
  // const matchingNonExtensionTabCount = currentSessionNonExtensionTabs.reduce(
  //   (a, o) => (matchingTabExists(o) ? a + 1 : a),
  //   0
  // );
  // const maxNonExtensionTabsCount = Math.max(
  //   lastSessionNonExtensionTabs.length,
  //   currentSessionNonExtensionTabs.length
  // );
  // log(
  //   'gsSession',
  //   matchingNonExtensionTabCount +
  //     ' / ' +
  //     maxNonExtensionTabsCount +
  //     ' tabs have the same id between the last session and the current session.'
  // );
  // if (
  //   matchingNonExtensionTabCount === 0 ||
  //   maxNonExtensionTabsCount - matchingNonExtensionTabCount > 1
  // ) {
  //   log('gsSession', 'Aborting tab recovery. Tab IDs do not match.');
  //   return false;
  // }

  // return true;
};

export const recoverLostTabs = async () => {
  const lastSession = await fetchLastSession();
  if (!lastSession) {
    return;
  }

  const recoveryStartTime = Date.now();
  log(
    'gsSession',
    '\n\n------------------------------------------------\n' +
      'Recovery mode started.\n' +
      '------------------------------------------------\n\n'
  );
  log('gsSession', 'lastSession: ', lastSession);
  removeInternalUrlsFromSession(lastSession);

  const currentWindows = await windowsGetAll();
  const matchedCurrentWindowBySessionWindowId = matchCurrentWindowsWithLastSessionWindows(
    lastSession.windows,
    currentWindows
  );

  //attempt to automatically restore any lost tabs/windows in their proper positions
  const lastFocusedWindow = await windowsGetLastFocused();
  const lastFocusedWindowId = lastFocusedWindow ? lastFocusedWindow.id : null;
  for (const sessionWindow of lastSession.windows) {
    const matchedCurrentWindow =
      matchedCurrentWindowBySessionWindowId[sessionWindow.id];
    await restoreSessionWindow(sessionWindow, matchedCurrentWindow, 0);
  }
  if (lastFocusedWindowId) {
    await windowsUpdate(lastFocusedWindowId, { focused: true });
  }

  startupRecoveryTimeTakenInSeconds = parseInt(
    (Date.now() - recoveryStartTime) / 1000
  );
  log(
    'gsSession',
    '\n\n------------------------------------------------\n' +
      'Recovery mode finished. Time taken: ' +
      startupRecoveryTimeTakenInSeconds +
      ' sec\n' +
      '------------------------------------------------\n\n'
  );
  log('gsSession', 'updating current session');
  updateCurrentSession(); //async
};

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
    ] = bestTabMatchingObject.currentWindow;

    //remove from unmatchedSessionWindows and unmatchedCurrentWindows
    const unmatchedSessionWindowsLengthBefore = unmatchedSessionWindows.length;
    unmatchedSessionWindows = unmatchedSessionWindows.filter(function(window) {
      return window.id !== bestTabMatchingObject.sessionWindow.id;
    });
    unmatchedCurrentWindows = unmatchedCurrentWindows.filter(function(window) {
      return window.id !== bestTabMatchingObject.currentWindow.id;
    });
    log(
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
    if (unmatchedSessionWindows.length >= unmatchedSessionWindowsLengthBefore) {
      break;
    }
  }

  return matchedCurrentWindowBySessionWindowId;
}

export const generateTabMatchingObjects = (sessionWindows, currentWindows) => {
  const unsuspendedSessionUrlsByWindowId = {};
  sessionWindows.forEach(function(sessionWindow) {
    unsuspendedSessionUrlsByWindowId[sessionWindow.id] = [];
    sessionWindow.tabs.forEach(function(curTab) {
      if (isNormalTab(curTab)) {
        unsuspendedSessionUrlsByWindowId[sessionWindow.id].push(curTab.url);
      }
    });
  });
  const unsuspendedCurrentUrlsByWindowId = {};
  currentWindows.forEach(function(currentWindow) {
    unsuspendedCurrentUrlsByWindowId[currentWindow.id] = [];
    currentWindow.tabs.forEach(function(curTab) {
      if (isNormalTab(curTab)) {
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
};

// suspendMode controls whether the tabs are restored as suspended or unsuspended
// 0: Leave the urls as they are (suspended stay suspended, ussuspended stay unsuspended)
// 1: Open all unsuspended tabs as suspended
// 2: Open all suspended tabs as unsuspended
export async function restoreSessionWindow(
  sessionWindow,
  existingWindow,
  suspendMode
) {
  if (sessionWindow.tabs.length === 0) {
    log('gsUtils', 'SessionWindow contains no tabs to restore');
  }

  // if we have been provided with a current window to recover into
  if (existingWindow) {
    log(
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
        !isSpecialTab(sessionTab) &&
        !currentTabUrls.includes(sessionTab.url) &&
        !currentTabIds.includes(sessionTab.id)
      ) {
        tabPromises.push(
          new Promise(resolve => {
            setTimeout(i * 20).then(() => {
              // dont await createNewTab as we want them to happen concurrently (but staggered)
              createNewTabFromSessionTab(
                sessionTab,
                existingWindow.id,
                sessionTab.index,
                suspendMode
              );
              resolve();
            });
          })
        );
      }
    }
    await Promise.all(tabPromises);
    return;
  }

  // else restore entire window
  log('gsUtils', 'Could not find match for sessionWindow: ', sessionWindow);

  const restoringUrl = chrome.runtime.getURL('restoring-window.html');
  // Create new window. Important: do not pass in all urls to chrome.windows.create
  // If you load too many windows (or tabs?) like this, then it seems to blow
  // out the GPU memory in the chrome task manager
  // TODO: Report chrome bug
  const newWindow = await createWindowAndWaitForFinishLoading(
    { url: restoringUrl, focused: false },
    500 // dont actually wait
  );
  const placeholderTab = newWindow.tabs[0];
  await tabsUpdate(placeholderTab.id, { pinned: true });

  const tabPromises = [];
  for (const [i, sessionTab] of sessionWindow.tabs.entries()) {
    tabPromises.push(
      new Promise(resolve => {
        setTimeout(i * (1000 / tabsToRestorePerSecond)).then(() => {
          // dont await createNewTab as we want them to happen concurrently (but staggered)
          createNewTabFromSessionTab(
            sessionTab,
            newWindow.id,
            i + 1,
            suspendMode
          );
          resolve();
        });
      })
    );
  }
  await Promise.all(tabPromises);
  if (placeholderTab) {
    await tabsRemove(placeholderTab.id);
  }
}

async function createNewTabFromSessionTab(
  sessionTab,
  windowId,
  index,
  suspendMode
) {
  let url = sessionTab.url;
  if (suspendMode === 1 && isNormalTab(sessionTab)) {
    url = generateSuspendUrl(sessionTab);
  } else if (suspendMode === 2 && isSuspendedTab(sessionTab)) {
    url = getOriginalUrlFromSuspendedUrl(sessionTab.url);
  }
  await tabsCreate({
    windowId: windowId,
    url: url,
    index: index,
    pinned: sessionTab.pinned,
    active: false,
  });

  // Update recovery view (if it exists)
  executeViewGlobalsForViewName('recovery', VIEW_FUNC_RECOVERY_REMOVE_TAB);
}

export const updateSessionMetrics = async reset => {
  reset = reset || false;

  const tabs = await tabsQuery();
  let curSuspendedTabCount = 0;
  for (const tab of tabs) {
    if (isSuspendedTab(tab)) {
      curSuspendedTabCount += 1;
    }
  }
  let sessionMetrics;
  if (reset) {
    log('gsSession', 'Resetting session metrics');
  } else {
    sessionMetrics = fetchSessionMetrics();
  }

  // If no session metrics exist then create a new one
  if (!sessionMetrics || !sessionMetrics[SM_TIMESTAMP]) {
    sessionMetrics = createNewSessionMetrics(curSuspendedTabCount, tabs.length);
    setSessionMetrics(sessionMetrics);
    log('gsSession', 'Created new session metrics', sessionMetrics);
    return;
  }

  // Else update metrics (if new max reached)
  const lastSuspendedTabCount = sessionMetrics[SM_SUSPENDED_TAB_COUNT];
  if (lastSuspendedTabCount < curSuspendedTabCount) {
    sessionMetrics[SM_SUSPENDED_TAB_COUNT] = curSuspendedTabCount;
    sessionMetrics[SM_TOTAL_TAB_COUNT] = tabs.length;
    setSessionMetrics(sessionMetrics);
    log('gsSession', 'Updated session metrics', sessionMetrics);
  }
};

export const createNewSessionMetrics = (suspendedTabCount, totalTabCount) => {
  const sessionMetrics = {
    [SM_TIMESTAMP]: Date.now(),
    [SM_SUSPENDED_TAB_COUNT]: suspendedTabCount,
    [SM_TOTAL_TAB_COUNT]: totalTabCount,
  };
  return sessionMetrics;
};

export const unsuspendActiveTabInEachWindow = async () => {
  const activeTabs = await tabsQuery({ active: true });
  const suspendedActiveTabs = activeTabs.filter(tab => isSuspendedTab(tab));
  if (suspendedActiveTabs.length === 0) {
    return;
  }
  for (const suspendedActiveTab of suspendedActiveTabs) {
    unsuspendTab(suspendedActiveTab);
  }
  await setTimeout(1000);
  await unsuspendActiveTabInEachWindow();
};

// For testing only!
export const initNewTestSession = async () => {
  sessionId = null;
};
