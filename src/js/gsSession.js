/*global chrome, localStorage, tgs, gsStorage, gsIndexedDb, gsUtils, gsMessages, gsAnalytics */
// eslint-disable-next-line no-unused-vars
var gsSession = (function() {
  'use strict';

  var startupChecksComplete = false;
  var initialisationMode = false;
  var initialisationTimeout = 5 * 60 * 1000;
  var isProbablyProfileRestart = false;
  var recoveryMode = false;
  var sessionId;
  var tabsUrlsToRecover = [];
  var updateType = null;

  function init() {
    //handle special event where an extension update is available
    chrome.runtime.onUpdateAvailable.addListener(function(details) {
      prepareForUpdate(details); //async
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

    if (!sessionRestorePoint || gsUtils.getSuspendedTabCount() > 0) {
      let updateUrl = chrome.extension.getURL('update.html');
      let updatedUrl = chrome.extension.getURL('updated.html');
      await Promise.all([
        gsUtils.removeTabsByUrlAsPromised(updateUrl),
        gsUtils.removeTabsByUrlAsPromised(updatedUrl),
      ]);
      //show update screen
      await new Promise(r => chrome.tabs.create({ url: updateUrl }));
    } else {
      // if there are no suspended tabs then simply install the update immediately
      chrome.runtime.reload();
    }
  }

  function getSessionId() {
    if (!sessionId) {
      //turn this into a string to make comparisons easier further down the track
      sessionId = Math.floor(Math.random() * 1000000) + '';
      gsUtils.log('gsSession', 'sessionId: ', sessionId);
    }
    return sessionId;
  }

  async function buildCurrentSession() {
    const currentWindows = await new Promise(r =>
      chrome.windows.getAll({ populate: true }, r)
    );
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
    return null;
  }

  async function updateCurrentSession() {
    const currentSession = await buildCurrentSession();
    if (currentSession) {
      await gsIndexedDb.updateSession(currentSession);
    } else {
      gsUtils.error('gsSession', 'Failed to update current session!');
    }
  }

  function isStartupChecksComplete() {
    return startupChecksComplete;
  }

  function isRecoveryMode() {
    return recoveryMode;
  }

  function isInitialising() {
    return initialisationMode;
  }

  function getUpdateType() {
    return updateType;
  }

  async function runStartupChecks() {
    initialisationMode = true;
    const tabs = (await new Promise(r => chrome.tabs.query({}, r))) || [];
    await checkForBrowserStartup(tabs);
    queueCheckTabsForResponsiveness(tabs);

    var lastVersion = gsStorage.fetchLastVersion();
    var curVersion = chrome.runtime.getManifest().version;

    if (chrome.extension.inIncognitoContext) {
      // do nothing if in incognito context
    } else if (lastVersion === curVersion) {
      await handleNormalStartup(curVersion, tabs);
    } else if (!lastVersion || lastVersion === '0.0.0') {
      await handleNewInstall(curVersion);
    } else {
      await handleUpdate(curVersion, lastVersion, tabs);
    }
    startupChecksComplete = true;
  }

  async function handleNormalStartup(curVersion, tabs) {
    const shouldRecoverTabs = await checkForCrashRecovery(tabs);
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
        await new Promise(r => chrome.tabs.create({ url: recoveryUrl }, (updateTab) => {
          //hax0r: wait for recovery tab to finish loading before returning
          //this is so we remain in 'recoveryMode' for a bit longer, preventing
          //the sessionUpdate code from running when this tab gains focus
          setTimeout(r, 2000);
        }));
      }
    } else {
      await gsIndexedDb.trimDbItems();
    }
    gsAnalytics.reportEvent('System', 'Restart', curVersion + '');
  }

  async function handleNewInstall(curVersion) {
    gsStorage.setLastVersion(curVersion);

    //show welcome message
    const optionsUrl = chrome.extension.getURL('options.html?firstTime');
    await new Promise(r => chrome.tabs.create({ url: optionsUrl }, r));
    gsAnalytics.reportEvent('System', 'Install', curVersion + '');
  }

  async function handleUpdate(curVersion, lastVersion, tabs) {
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

    await gsIndexedDb.performMigration(lastVersion);
    gsStorage.setNoticeVersion('0');
    const shouldRecoverTabs = await checkForCrashRecovery(tabs);
    if (shouldRecoverTabs) {
      await recoverLostTabs();
    }

    let updateUrl = chrome.extension.getURL('update.html');
    let updatedUrl = chrome.extension.getURL('updated.html');
    await gsUtils.removeTabsByUrlAsPromised(updateUrl);
    await gsUtils.removeTabsByUrlAsPromised(updatedUrl);

    //show updated screen
    await new Promise(r => chrome.tabs.create({ url: updatedUrl }, r));

    gsAnalytics.reportEvent(
      'System',
      'Update',
      lastVersion + ' -> ' + curVersion
    );
  }

  function queueCheckTabsForResponsiveness(tabs) {
    //make sure the contentscript / suspended script of each tab is responsive
    //if we are in the process of a chrome restart (and session restore) then it might take a while
    //for the scripts to respond. we use progressive timeouts of 4, 8, 16, 32 ...
    var tabCheckPromises = [];
    gsUtils.log(
      'gsSession',
      '\n\n------------------------------------------------\n' +
        `Extension initialization started. isProbablyProfileRestart: ${isProbablyProfileRestart}\n` +
        '------------------------------------------------\n\n'
    );
    //increase max time allowed for initialisation if dealing with a large number of tabs
    //every extra 50 tabs past 100 adds an extra allowed minute for init
    if (tabs.length > 100) {
      var extraMinutes = parseInt((tabs.length - 100) / 50, 10) + 1;
      initialisationTimeout += extraMinutes * 60 * 1000;
      gsUtils.log(
        'gsSession',
        `Increasing init timeout to ${initialisationTimeout / 1000 / 60}mins`
      );
    }
    for (const currentTab of tabs) {
      const tabsToInitPerSecond = 10;
      const timeoutRandomiser = parseInt(Math.random() * tabs.length / tabsToInitPerSecond * 1000);
      const timeout = timeoutRandomiser + 1000; //minimum timeout of 1 second
      gsUtils.log(currentTab.id, `Queuing tab for initialisation check in ${timeout/1000} seconds.`);
      tabCheckPromises.push(
        queueTabScriptCheck(currentTab, timeout)
      );
    }
    Promise.all(tabCheckPromises)
      .then(() => {
        initialisationMode = false;
        gsUtils.log(
          'gsSession',
          '\n\n------------------------------------------------\n' +
            'Extension initialization finished.\n' +
            '------------------------------------------------\n\n'
        );
      })
      .catch(error => {
        initialisationMode = false;
        gsUtils.error('gsSession', error);
        gsUtils.error(
          'gsSession',
          '\n\n------------------------------------------------\n' +
            'Extension initialization FAILED.\n' +
            '------------------------------------------------\n\n'
        );
      });
  }

  //TODO: Improve this function to determine browser startup with 100% certainty
  //NOTE: Current implementation leans towards conservatively saying it's not a browser startup
  async function checkForBrowserStartup(currentTabs) {
    //check for suspended tabs in current session
    //if found, then we can probably assume that this is a browser startup which is restoring previously open tabs
    const suspendedTabs = [];
    for (var curTab of currentTabs) {
      if (
        !gsUtils.isSpecialTab(curTab) &&
        gsUtils.isSuspendedTab(curTab, true)
      ) {
        suspendedTabs.push(curTab);
      }
    }
    if (suspendedTabs.length > 0) {
      gsUtils.log('gsSession', 'isProbablyProfileRestart: true', suspendedTabs);
      isProbablyProfileRestart = true;
    }
  }

  async function checkForCrashRecovery(currentTabs) {
    gsUtils.log(
      'gsSession',
      'Checking for crash recovery: ' + new Date().toISOString()
    );

    if (isProbablyProfileRestart) {
      gsUtils.log(
        'gsSession',
        'Aborting tab recovery. Browser is probably starting (as there are still suspended tabs open..)'
      );
      return false;
    }

    //try to detect whether the extension has crashed as separate to chrome crashing
    //if it is just the extension that has crashed, then in theory all suspended tabs will be gone
    //and all normal tabs will still exist with the same ids
    var lastSessionSuspendedTabCount = 0,
      lastSessionUnsuspendedTabCount = 0,
      lastSessionUnsuspendedTabs = [];

    const lastSession = await gsIndexedDb.fetchLastSession();
    if (!lastSession) {
      return false;
    }
    gsUtils.log('gsSession', 'lastSession: ', lastSession);

    //collect all nonspecial, unsuspended tabs from the last session
    for (const sessionWindow of lastSession.windows) {
      for (const sessionTab of sessionWindow.tabs) {
        if (!gsUtils.isSpecialTab(sessionTab)) {
          if (!gsUtils.isSuspendedTab(sessionTab, true)) {
            lastSessionUnsuspendedTabs.push(sessionTab);
            lastSessionUnsuspendedTabCount++;
          } else {
            lastSessionSuspendedTabCount++;
          }
        }
      }
    }

    //don't attempt recovery if last session had no suspended tabs
    if (lastSessionSuspendedTabCount === 0) {
      gsUtils.log(
        'gsSession',
        'Aborting tab recovery. Last session has no suspended tabs.'
      );
      return false;
    }

    //check to see if they still exist in current session
    gsUtils.log('gsSession', 'currentTabs: ', currentTabs);
    gsUtils.log(
      'gsSession',
      'lastSessionUnsuspendedTabs: ',
      lastSessionUnsuspendedTabs
    );

    //don't attempt recovery if there are less tabs in current session than there were
    //unsuspended tabs in the last session
    if (currentTabs.length < lastSessionUnsuspendedTabCount) {
      gsUtils.log(
        'gsSession',
        'Aborting tab recovery. Last session contained ' +
          lastSessionUnsuspendedTabCount +
          'tabs. Current session only contains ' +
          currentTabs.length
      );
      return false;
    }

    //if there is only one currently open tab and it is the 'new tab' page then abort recovery
    if (currentTabs.length === 1 && currentTabs[0].url === 'chrome://newtab/') {
      gsUtils.log(
        'gsSession',
        'Aborting tab recovery. Current session only contains a single newtab page.'
      );
      return false;
    }
    return true;
  }

  async function queueTabScriptCheck(tab, timeout, totalTimeQueued) {
    totalTimeQueued = totalTimeQueued || 0;
    if (gsUtils.isSpecialTab(tab) || gsUtils.isDiscardedTab(tab)) {
      return;
    }
    if (totalTimeQueued >= initialisationTimeout) {
      gsUtils.error(
        tab.id,
        `Failed to initialize tab. Tab may not behave as expected.`
      );
      return;
    }
    await new Promise(resolve => setTimeout(resolve, timeout));
    let _tab = await getCurrentStateOfTab(tab);
    if (!_tab) {
      gsUtils.log(
        tab.id,
        `Failed to initialize tab. Tab may have been removed or discarded.`
      );
      return;
    } else {
      tab = _tab;
    }
    totalTimeQueued += timeout;
    gsUtils.log(
      tab.id,
      `${parseInt(
        totalTimeQueued / 1000
      )} seconds has elapsed. Pinging tab with state: ${tab.status}..`
    );
    const result = await pingTabScript(tab, totalTimeQueued);
    if (!result) {
      const nextTimeout = timeout * 2;
      gsUtils.log(
        tab.id,
        `Tab has still not initialised after ${totalTimeQueued /
          1000}. Re-queuing in another ${nextTimeout / 1000} seconds.`
      );
      await queueTabScriptCheck(tab, nextTimeout, totalTimeQueued);
    }
  }

  async function getCurrentStateOfTab(tab) {
    const newTab = await new Promise(r => chrome.tabs.get(tab.id, r));
    if (chrome.runtime.lastError) {
      gsUtils.log(tab.id, chrome.runtime.lastError);
    }
    if (newTab) {
      return newTab;
    }
    if (!gsUtils.isSuspendedTab(tab, true)) {
      return null;
    }
    // If suspended tab has been discarded before init then it may stay in 'blockhead' state
    // Therefore we want to reload this tab to make sure it can be suspended properly
    const discardedTab = await findPotentialDiscardedSuspendedTab(tab);
    if (!discardedTab) {
      return null;
    }
    gsUtils.log(
      discardedTab.id,
      `Suspended tab with id: ${
        tab.id
      } was discarded before init. Will reload..`
    );
    await new Promise(r =>
      chrome.tabs.update(discardedTab.id, { url: discardedTab.url }, r)
    );
    return discardedTab;
  }

  async function findPotentialDiscardedSuspendedTab(suspendedTab) {
    // NOTE: For some reason querying by url doesn't work here??
    let tabs = new Promise(r =>
      chrome.tabs.query(
        {
          discarded: true,
          windowId: suspendedTab.windowId,
        },
        r
      )
    );
    tabs = tabs.filter(o => o.url === suspendedTab.url);
    if (tabs.length === 1) {
      return tabs[0];
    } else if (tabs.length > 1) {
      let matchingTab = tabs.find(o => o.index === suspendedTab.index);
      matchingTab = matchingTab || tabs[0];
      return matchingTab;
    } else {
      return null;
    }
  }

  function pingTabScript(tab, totalTimeQueued) {
    return new Promise((resolve, reject) => {
      // If tab has a state of loading, then requeue for checking later
      if (tab.status === 'loading') {
        resolve(false);
        return;
      }
      gsMessages.sendPingToTab(tab.id, function(err, response) {
        // If tab is initialised then return true
        if (response && response.isInitialised) {
          resolve(true);
          return;
        }

        // If tab returned a response (but is not initialised or loading) then initialise
        if (response) {
          if (gsUtils.isSuspendedTab(tab)) {
            tgs
              .initialiseSuspendedTabAsPromised(tab)
              .then(response => {
                resolve(response && response.isInitialised);
              })
              .catch(error => {
                resolve(false);
              });
          } else {
            tgs
              .initialiseUnsuspendedTabAsPromised(tab)
              .then(response => {
                resolve(response && response.isInitialised);
              })
              .catch(error => {
                resolve(false);
              });
          }
          return;
        }

        if (isProbablyProfileRestart && totalTimeQueued < 60 * 1000) {
          resolve(false);
          return;
        }

        // If tab has loaded but returns no response after 60 seconds then try to reload / reinject tab
        if (gsUtils.isSuspendedTab(tab)) {
          // resuspend unresponsive suspended tabs
          gsUtils.log(tab.id, `Resuspending unresponsive suspended tab.`);
          tgs.setTabFlagForTabId(tab.id, tgs.UNSUSPEND_ON_RELOAD_URL, null);
          chrome.tabs.reload(tab.id, function() {
            resolve(false);
          });
        } else {
          // reinject content script on non-suspended tabs
          gsUtils.log(
            tab.id,
            `Reinjecting contentscript into unresponsive active tab.`
          );
          gsMessages.executeScriptOnTab(tab.id, 'js/contentscript.js', function(
            err
          ) {
            resolve(false);
          });
        }
      });
    });
  }

  async function recoverLostTabs() {
    const lastSession = await gsIndexedDb.fetchLastSession();
    if (!lastSession) {
      return;
    }

    gsUtils.log(
      'gsSession',
      '\n\n------------------------------------------------\n' +
        'Recovery mode started.\n' +
        '------------------------------------------------\n\n'
    );

    recoveryMode = true;
    gsUtils.removeInternalUrlsFromSession(lastSession);

    const currentWindows = await new Promise(r =>
      chrome.windows.getAll({ populate: true }, r)
    );
    var matchedCurrentWindowBySessionWindowId = matchCurrentWindowsWithLastSessionWindows(
      lastSession.windows,
      currentWindows
    );

    //attempt to automatically restore any lost tabs/windows in their proper positions
    for (var sessionWindow of lastSession.windows) {
      var matchedCurrentWindow =
        matchedCurrentWindowBySessionWindowId[sessionWindow.id];
      await recoverWindow(sessionWindow, matchedCurrentWindow);
    }
    var focusedWindow = currentWindows.find(o => o.focused);
    if (focusedWindow) {
      await new Promise(r =>
        chrome.windows.update(focusedWindow.id, { focused: true }, r)
      );
    }
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
        gsUtils.log(
          'gsUtils',
          'Matched with ids: ',
          sessionWindow,
          matchingCurrentWindow
        );
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

  async function recoverWindow(sessionWindow, currentWindow) {
    const currentTabIds = [];
    const currentTabUrls = [];
    const recoverSessionPromises = [];

    //if we have been provided with a current window to recover into
    if (currentWindow) {
      for (const currentTab of currentWindow.tabs) {
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
          tabsUrlsToRecover.push(sessionTab.url);
          recoverSessionPromises.push(
            new Promise(r =>
              chrome.tabs.create(
                {
                  windowId: currentWindow.id,
                  url: sessionTab.url,
                  index: sessionTab.index,
                  pinned: sessionTab.pinned,
                  active: false,
                },
                r
              )
            )
          );
        }
      }

      //else restore entire window
    } else if (sessionWindow.tabs.length > 0) {
      gsUtils.log(
        'gsUtils',
        'Could not find match for sessionWindow: ',
        sessionWindow
      );

      //create list of urls to open
      var tabUrls = [];
      for (const sessionTab of sessionWindow.tabs) {
        tabUrls.push(sessionTab.url);
        tabsUrlsToRecover.push(sessionTab.url);
      }
      recoverSessionPromises.push(
        new Promise(r =>
          chrome.windows.create({ url: tabUrls, focused: false }, r)
        )
      );
    }
    await Promise.all(recoverSessionPromises);
  }

  function handleTabRecovered(tab) {
    if (tabsUrlsToRecover.indexOf(tab.url) >= 0) {
      tabsUrlsToRecover.splice(tabsUrlsToRecover.indexOf(tab.url), 1);
    }
    if (tabsUrlsToRecover.length === 0) {
      recoveryMode = false;
      gsUtils.log(
        'gsSession',
        '\n\n------------------------------------------------\n' +
          'Recovery mode finished.\n' +
          '------------------------------------------------\n\n'
      );
      gsUtils.log('gsSession', 'updating current session');
      updateCurrentSession(); //async
    }

    // Update recovery view (if it exists)
    chrome.tabs.query(
      { url: chrome.extension.getURL('recovery.html') },
      function(recoveryTabs) {
        for (var recoveryTab of recoveryTabs) {
          gsMessages.sendTabInfoToRecoveryTab(recoveryTab.id, tab);
        }
      }
    );
  }

  return {
    init,
    runStartupChecks,
    getSessionId,
    buildCurrentSession,
    updateCurrentSession,
    handleTabRecovered,
    isInitialising,
    isStartupChecksComplete,
    isRecoveryMode,
    recoverLostTabs,
    prepareForUpdate,
    getUpdateType,
  };
})();
