/*global chrome, localStorage, tgs, db, gsStorage, gsUtils, gsMessages, gsAnalytics */
var gsSession = (function () { // eslint-disable-line no-unused-vars
    'use strict';

    var initialisationMode = false;
    var isProbablyBrowserRestart = false;
    var recoveryMode = false;
    var sessionId;
    var tabsUrlsToRecover = [];

    //handle special event where an extension update is available
    chrome.runtime.onUpdateAvailable.addListener(function (details) {
        prepareForUpdate(details);
    });

    function prepareForUpdate(newVersionDetails) {

        var currentVersion = chrome.runtime.getManifest().version;
        var newVersion = newVersionDetails.version;

        gsUtils.log('gsSession','A new version is available: ' + currentVersion + ' -> ' + newVersion);

        gsStorage.createSessionRestorePoint(currentVersion, newVersion)
            .then(function (session) {
                if (!session || gsUtils.getSuspendedTabCount() > 0) {
                    if (!gsUtils.isExtensionTabOpen('update')) {
                        chrome.tabs.create({url: chrome.extension.getURL('update.html')});
                    }
                // if there are no suspended tabs then simply install the update immediately
                } else {
                    chrome.runtime.reload();
                }
            });

    }

    function getSessionId() {
        if (!sessionId) {
            //turn this into a string to make comparisons easier further down the track
            sessionId =  Math.floor(Math.random() * 1000000) + '';
            gsUtils.log('gsSession','sessionId: ', sessionId);
        }
        return sessionId;
    }

    function isRecoveryMode() {
        return recoveryMode;
    }

    function isInitialising() {
        return initialisationMode;
    }

    function backgroundScriptsReadyAsPromsied(retries) {
        retries = retries || 0;
        if (retries > 300) { // allow 30 seconds :scream:
            return Promise.reject();
        }
        return new Promise(function (resolve) {
            var isReady = chrome.extension.getBackgroundPage() &&
                typeof db !== 'undefined' &&
                typeof gsStorage !== 'undefined' &&
                typeof gsMessages !== 'undefined' &&
                typeof gsUtils !== 'undefined' &&
                typeof gsAnalytics !== 'undefined';
            // console.log('isReady',isReady);
            resolve(isReady);
        }).then(function (isReady) {
            if (isReady) {
                return Promise.resolve();
            }
            return new Promise(function (resolve) {
                window.setTimeout(resolve, 100);
            }).then(function () {
                retries += 1;
                return backgroundScriptsReadyAsPromsied(retries);
            });
        });
    }

    function runStartupChecks() {
        backgroundScriptsReadyAsPromsied().then(function () {
            initialisationMode = true;
            chrome.tabs.query({}, function (tabs) {
                checkForBrowserStartup(tabs);

                var lastVersion = gsStorage.fetchLastVersion(),
                    curVersion = chrome.runtime.getManifest().version;

                //if version has changed then assume initial install or upgrade
                if (!chrome.extension.inIncognitoContext && (lastVersion !== curVersion)) {
                    gsStorage.setLastVersion(curVersion);

                    //if they are installing for the first time
                    if (!lastVersion || lastVersion === '0.0.0') {

                        //show welcome screen
                        chrome.tabs.create({url: chrome.extension.getURL('welcome.html')});

                    //else if they are upgrading to a new version
                    } else {

                        findOrCreateSessionRestorePoint(lastVersion, curVersion).then(function (session) {

                            gsStorage.performMigration(lastVersion);

                            //reset notice version
                            gsStorage.setNoticeVersion('0');

                            //clear context menu
                            tgs.buildContextMenu(false);

                            //recover tabs silently
                            checkForCrashRecovery(tabs, true);

                            //close any 'update' and 'updated' tabs that may be open
                            chrome.tabs.query({url: chrome.extension.getURL('update.html')}, function (tabs) {
                                chrome.tabs.remove(tabs.map(function (tab) { return tab.id; }));
                            });
                            chrome.tabs.query({url: chrome.extension.getURL('updated.html')}, function (tabs) {
                                chrome.tabs.remove(tabs.map(function (tab) { return tab.id; }));

                                //show updated screen
                                chrome.tabs.create({url: chrome.extension.getURL('updated.html')});
                            });
                        });
                    }

                //else if restarting the same version
                } else {

                    //check for possible crash
                    checkForCrashRecovery(tabs, false);

                    //trim excess dbItems
                    gsStorage.trimDbItems();
                }

                //add context menu items
                var contextMenus = gsStorage.getOption(gsStorage.ADD_CONTEXT);
                tgs.buildContextMenu(contextMenus);

                //initialise globalCurrentTabId (important that this comes last. cant remember why?!?!)
                tgs.init();

                //initialise settings (important that this comes last. cant remember why?!?!)
                gsStorage.initSettings();

                if (tabs) {
                    //make sure the contentscript / suspended script of each tab is responsive
                    //if we are in the process of a chrome restart (and session restore) then it might take a while
                    //for the scripts to respond. we use progressive timeouts of 4, 8, 16, 32 ...
                    var tabCheckPromises = [];
                    gsUtils.log('gsSession', '\n\n------------------------------------------------\n' +
                        `Extension initialization started. isProbablyBrowserRestart: ${isProbablyBrowserRestart}\n` +
                        '------------------------------------------------\n\n');
                    for (const currentTab of tabs) {
                        const timeoutRandomiser = Math.random() * 1000 * (tabs.length / 2);
                        tabCheckPromises.push(queueTabScriptCheck(currentTab, (4 * 1000) + timeoutRandomiser));
                    }
                    Promise.all(tabCheckPromises).then(() => {
                        initialisationMode = false;
                        gsUtils.log('gsSession', '\n\n------------------------------------------------\n' +
                            'Extension initialization finished.\n' +
                            '------------------------------------------------\n\n');
                    }).catch((error) => {
                        initialisationMode = false;
                        gsUtils.error('gsSession', error);
                        gsUtils.error('gsSession', '\n\n------------------------------------------------\n' +
                            'Extension initialization FAILED.\n' +
                            '------------------------------------------------\n\n');
                    });
                }
            });
        }).catch(function (err) {
            gsUtils.error('gsSession', err);
            chrome.tabs.create({ url: chrome.extension.getURL('broken.html') });
        });
    }

    function findOrCreateSessionRestorePoint(lastVersion, curVersion) {
        return gsStorage.fetchSessionRestorePoint(gsStorage.DB_SESSION_POST_UPGRADE_KEY, curVersion)
            .then(function (session) {
                if (session) {
                    return session;
                } else {
                    return gsStorage.createSessionRestorePoint(lastVersion, curVersion);
                }
            });
    }

    //TODO: Improve this function to determine browser startup with 100% certainty
    //NOTE: Current implementation leans towards conservatively saying it's not a browser startup
    function checkForBrowserStartup(currentTabs) {
        //check for suspended tabs in current session
        //if found, then we can probably assume that this is a browser startup which is restoring previously open tabs
        const suspendedTabs = [];
        for (var curTab of currentTabs) {
            if (!gsUtils.isSpecialTab(curTab) && gsUtils.isSuspendedTab(curTab, true)) {
                suspendedTabs.push(curTab);
            }
        }
        if (suspendedTabs.length > 0) {
            isProbablyBrowserRestart = true;
        }
    }

    function checkForCrashRecovery(currentTabs, isUpdating) {
        gsUtils.log('gsSession','\n\n\nCRASH RECOVERY CHECKS!!!!! ' + Date.now() + '\n\n\n');

        //try to detect whether the extension has crashed as separate to chrome crashing
        //if it is just the extension that has crashed, then in theory all suspended tabs will be gone
        //and all normal tabs will still exist with the same ids

        var lastSessionSuspendedTabCount = 0,
            lastSessionUnsuspendedTabCount = 0,
            lastSessionUnsuspendedTabs = [];

        gsUtils.log('gsSession','Checking for crash recovery');

        if (isProbablyBrowserRestart) {
            gsUtils.log('gsSession','Aborting tab recovery. Browser is probably starting (as there are still suspended tabs open..)');
            return;
        }

        gsStorage.fetchLastSession().then(function (lastSession) {

            if (!lastSession) {
                return;
            }
            gsUtils.log('gsSession','lastSession: ', lastSession);

            //collect all nonspecial, unsuspended tabs from the last session
            lastSession.windows.forEach(function (sessionWindow) {
                sessionWindow.tabs.forEach(function (sessionTab) {

                    if (!gsUtils.isSpecialTab(sessionTab)) {
                        if (!gsUtils.isSuspendedTab(sessionTab, true)) {
                            lastSessionUnsuspendedTabs.push(sessionTab);
                            lastSessionUnsuspendedTabCount++;
                        } else {
                            lastSessionSuspendedTabCount++;
                        }
                    }
                });
            });

            //don't attempt recovery if last session had no suspended tabs
            if (lastSessionSuspendedTabCount === 0) {
                gsUtils.log('gsSession','Aborting tab recovery. Last session has no suspended tabs.');
                return;
            }

            //check to see if they still exist in current session
            gsUtils.log('gsSession','Tabs in current session: ', currentTabs);
            gsUtils.log('gsSession','Unsuspended session tabs: ', lastSessionUnsuspendedTabs);

            //don't attempt recovery if there are less tabs in current session than there were
            //unsuspended tabs in the last session
            if (currentTabs.length < lastSessionUnsuspendedTabCount) {
                gsUtils.log('gsSession','Aborting tab recovery. Last session contained ' + lastSessionUnsuspendedTabCount +
                        'tabs. Current session only contains ' + currentTabs.length);
                return;
            }

            //if there is only one currently open tab and it is the 'new tab' page then abort recovery
            if (currentTabs.length === 1 && currentTabs[0].url === 'chrome://newtab/') {
                gsUtils.log('gsSession','Aborting tab recovery. Current session only contains a single newtab page.');
                return;
            }

            var lastExtensionRecoveryTimestamp = gsStorage.fetchLastExtensionRecoveryTimestamp();
            var hasCrashedRecently = lastExtensionRecoveryTimestamp && (Date.now() - lastExtensionRecoveryTimestamp) < (1000*60*5);
            gsStorage.setLastExtensionRecoveryTimestamp(Date.now());

            //if we are doing an update, or this is the first recent crash, then automatically recover lost tabs
            if (isUpdating || !hasCrashedRecently) {
                recoverLostTabs(null);

            //otherwise show the recovery page
            } else {
                chrome.tabs.create({url: chrome.extension.getURL('recovery.html')});
            }
        });
    }

    async function queueTabScriptCheck(tab, timeout, totalTimeQueued) {
        totalTimeQueued = totalTimeQueued || 0;
        if (gsUtils.isSpecialTab(tab) || gsUtils.isDiscardedTab(tab)) {
            return;
        }
        if (totalTimeQueued >= 5 * 60 * 1000) {
            gsUtils.error(tab.id, `Failed to initialize tab. Tab may not behave as expected.`);
            return;
        }
        await new Promise(resolve => setTimeout(resolve, timeout));
        let _tab = await new Promise(resolve => chrome.tabs.get(tab.id, function (newTab) {
            if (chrome.runtime.lastError) {
                gsUtils.log(tab.id, chrome.runtime.lastError);
                resolve();
                return;
            }
            resolve(newTab);
        }));
        if (!_tab) {
            gsUtils.log(tab.id, `Failed to initialize tab. Tab may have been removed.`);
            return;
        } else {
            tab = _tab;
        }
        totalTimeQueued += (timeout);
        gsUtils.log(tab.id, `${parseInt(totalTimeQueued / 1000)} seconds has elapsed. Pinging tab with state: ${tab.status}..`);
        const result = await pingTabScript(tab, totalTimeQueued);
        if (!result) {
            const nextTimeout = (timeout * 2);
            await queueTabScriptCheck(tab, nextTimeout, totalTimeQueued);
        }
    }

    function pingTabScript(tab, totalTimeQueued) {
        return new Promise((resolve, reject) => {

            // If tab has a state of loading, then requeue for checking later
            if (tab.status === 'loading') {
                resolve(false);
                return;
            }
            gsMessages.sendPingToTab(tab.id, function (err, response) {

                // If tab is initialised then return true
                if (response && response.isInitialised) {
                    resolve(true);
                    return;
                }

                // If tab returned a response (but is not initialised or loading) then initialise
                if (response) {
                    if (gsUtils.isSuspendedTab(tab)) {
                        tgs.initialiseSuspendedTab(tab, function () {
                            pingTabScript(tab, totalTimeQueued).then(resolve);
                        });
                    } else {
                        tgs.initialiseUnsuspendedTab(tab, function () {
                            pingTabScript(tab, totalTimeQueued).then(resolve);
                        });
                    }
                    return;
                }

                if (isProbablyBrowserRestart && totalTimeQueued < (60 * 1000)) {
                    resolve(false);
                    return;
                }

                // If tab has loaded but returns no response after 30 seconds then try to reload / reinject tab
                if (gsUtils.isSuspendedTab(tab)) {
                    // resuspend unresponsive suspended tabs
                    gsUtils.log(tab.id, `Resuspending unresponsive suspended tab.`);
                    tgs.setTabFlagForTabId(tab.id, tgs.UNSUSPEND_ON_RELOAD, false);
                    chrome.tabs.reload(tab.id);
                    resolve(false);
                } else {
                    // reinject content script on non-suspended tabs
                    gsUtils.log(tab.id, `Reinjecting contentscript into unresponsive active tab.`);
                    gsMessages.executeScriptOnTab(tab.id, 'js/contentscript.js', function (err) {
                        if (err) {
                            resolve(false);
                        } else {
                            pingTabScript(tab, totalTimeQueued).then(resolve);
                        }
                    });
                }
            });
        });
    }

    function recoverLostTabs(callback) {
        callback = typeof callback !== 'function' ? function () {} : callback;

        gsStorage.fetchLastSession().then(function (lastSession) {
            if (!lastSession) {
                callback(null);
            }
            gsUtils.removeInternalUrlsFromSession(lastSession);
            chrome.windows.getAll({ populate: true }, function (currentWindows) {
                var focusedWindow = currentWindows.find(function (currentWindow) { return currentWindow.focused; });
                var matchedCurrentWindowBySessionWindowId = matchCurrentWindowsWithLastSessionWindows(lastSession.windows, currentWindows);

                var recoverWindows = async function (done) {
                    //attempt to automatically restore any lost tabs/windows in their proper positions
                    for (var sessionWindow of lastSession.windows) {
                        var matchedCurrentWindow = matchedCurrentWindowBySessionWindowId[sessionWindow.id];
                        await recoverWindowAsPromise(sessionWindow, matchedCurrentWindow);
                    }
                    if (focusedWindow) {
                        chrome.windows.update(focusedWindow.id, { focused: true }, done);
                    } else {
                        done();
                    }
                };
                recoveryMode = true;
                recoverWindows(function () {
                    callback();
                });
            });
        });
    }

    //try to match session windows with currently open windows
    function matchCurrentWindowsWithLastSessionWindows(unmatchedSessionWindows, unmatchedCurrentWindows) {
        var matchedCurrentWindowBySessionWindowId = {};

        //if there is a current window open that matches the id of the session window id then match it
        unmatchedSessionWindows.slice().forEach(function (sessionWindow) {
            var matchingCurrentWindow = unmatchedCurrentWindows.find(function (window) { return window.id === sessionWindow.id; });
            if (matchingCurrentWindow) {
                matchedCurrentWindowBySessionWindowId[sessionWindow.id] = matchingCurrentWindow;
                //remove from unmatchedSessionWindows and unmatchedCurrentWindows
                unmatchedSessionWindows = unmatchedSessionWindows.filter(function (window) { return window.id !== sessionWindow.id; });
                unmatchedCurrentWindows = unmatchedCurrentWindows.filter(function (window) { return window.id !== matchingCurrentWindow.id; });
                gsUtils.log('gsUtils', 'Matched with ids: ', sessionWindow, matchingCurrentWindow);
            }
        });

        if (unmatchedSessionWindows.length === 0 || unmatchedCurrentWindows.length === 0) {
            return matchedCurrentWindowBySessionWindowId;
        }

        //if we still have session windows that haven't been matched to a current window then attempt matching based on tab urls
        var tabMatchingObjects = generateTabMatchingObjects(unmatchedSessionWindows, unmatchedCurrentWindows);

        //find the tab matching objects with the highest tabMatchCounts
        while (unmatchedSessionWindows.length > 0 && unmatchedCurrentWindows.length > 0) {
            var maxTabMatchCount = Math.max(...tabMatchingObjects.map(function (o) { return o.tabMatchCount; }));
            var bestTabMatchingObject = tabMatchingObjects.find(function (o) { return o.tabMatchCount === maxTabMatchCount; });

            matchedCurrentWindowBySessionWindowId[bestTabMatchingObject.sessionWindow.id] = bestTabMatchingObject.currentWindow;

            //remove from unmatchedSessionWindows and unmatchedCurrentWindows
            var unmatchedSessionWindowsLengthBefore = unmatchedSessionWindows.length;
            unmatchedSessionWindows = unmatchedSessionWindows.filter(function (window) { return window.id !== bestTabMatchingObject.sessionWindow.id; });
            unmatchedCurrentWindows = unmatchedCurrentWindows.filter(function (window) { return window.id !== bestTabMatchingObject.currentWindow.id; });
            gsUtils.log('gsUtils', 'Matched with tab count of ' + maxTabMatchCount + ': ', bestTabMatchingObject.sessionWindow, bestTabMatchingObject.currentWindow);

            //remove from tabMatchingObjects
            tabMatchingObjects = tabMatchingObjects.filter(function (o) { return o.sessionWindow !== bestTabMatchingObject.sessionWindow & o.currentWindow !== bestTabMatchingObject.currentWindow; });

            //safety check to make sure we dont get stuck in infinite loop. should never happen though.
            if (unmatchedSessionWindows.length >= unmatchedSessionWindowsLengthBefore) {
                break;
            }
        }

        return matchedCurrentWindowBySessionWindowId;
    }

    function generateTabMatchingObjects(sessionWindows, currentWindows) {
        var unsuspendedSessionUrlsByWindowId = {};
        sessionWindows.forEach(function (sessionWindow) {
            unsuspendedSessionUrlsByWindowId[sessionWindow.id] = [];
            sessionWindow.tabs.forEach(function (curTab) {
                if (!gsUtils.isSpecialTab(curTab) && !gsUtils.isSuspendedTab(curTab)) {
                    unsuspendedSessionUrlsByWindowId[sessionWindow.id].push(curTab.url);
                }
            });
        });
        var unsuspendedCurrentUrlsByWindowId = {};
        currentWindows.forEach(function (currentWindow) {
            unsuspendedCurrentUrlsByWindowId[currentWindow.id] = [];
            currentWindow.tabs.forEach(function (curTab) {
                if (!gsUtils.isSpecialTab(curTab) && !gsUtils.isSuspendedTab(curTab)) {
                    unsuspendedCurrentUrlsByWindowId[currentWindow.id].push(curTab.url);
                }
            });
        });

        var tabMatchingObjects = [];
        sessionWindows.forEach(function (sessionWindow) {
            currentWindows.forEach(function (currentWindow) {
                var unsuspendedSessionUrls = unsuspendedSessionUrlsByWindowId[sessionWindow.id];
                var unsuspendedCurrentUrls = unsuspendedCurrentUrlsByWindowId[currentWindow.id];
                var matchCount = unsuspendedCurrentUrls.filter(function (url) { return unsuspendedSessionUrls.includes(url); }).length;
                tabMatchingObjects.push({
                    tabMatchCount: matchCount,
                    sessionWindow: sessionWindow,
                    currentWindow: currentWindow
                });
            });
        });

        return tabMatchingObjects;
    }

    function recoverWindowAsPromise(sessionWindow, currentWindow) {
        var currentTabIds = [],
            currentTabUrls = [];

        return new Promise(function (resolve, reject) {

            //if we have been provided with a current window to recover into
            if (currentWindow) {
                currentWindow.tabs.forEach(function (currentTab) {
                    currentTabIds.push(currentTab.id);
                    currentTabUrls.push(currentTab.url);
                });

                sessionWindow.tabs.forEach(function (sessionTab) {

                    //if current tab does not exist then recreate it
                    if (!gsUtils.isSpecialTab(sessionTab) &&
                        !currentTabUrls.includes(sessionTab.url) && !currentTabIds.includes(sessionTab.id)) {
                        tabsUrlsToRecover.push(sessionTab.url);
                        chrome.tabs.create({
                            windowId: currentWindow.id,
                            url: sessionTab.url,
                            index: sessionTab.index,
                            pinned: sessionTab.pinned,
                            active: false
                        });
                    }
                });
                resolve();

            //else restore entire window
            } else if (sessionWindow.tabs.length > 0) {
                gsUtils.log('gsUtils', 'Could not find match for sessionWindow: ', sessionWindow);

                //create list of urls to open
                var tabUrls = [];
                sessionWindow.tabs.forEach(function (sessionTab) {
                    tabUrls.push(sessionTab.url);
                    tabsUrlsToRecover.push(sessionTab.url);
                });
                chrome.windows.create({url: tabUrls, focused: false}, resolve);
            }
        });
    }

    function handleTabRecovered(tab) {
        if (tabsUrlsToRecover.indexOf(tab.url) >= 0) {
            tabsUrlsToRecover.splice(tabsUrlsToRecover.indexOf(tab.url), 1);
        }
        if (tabsUrlsToRecover.length === 0) {
            recoveryMode = false;
            gsUtils.log('gsSession', '\n\n------------------------------------------------\n' +
                'Recovery mode finished.\n' +
                '------------------------------------------------\n\n');
        }

        // Update recovery view (if it exists)
        chrome.tabs.query({url: chrome.extension.getURL('recovery.html')}, function (recoveryTabs) {
            for (var recoveryTab of recoveryTabs) {
                gsMessages.sendTabInfoToRecoveryTab(recoveryTab.id, tab);
            }
        });
    }

    return {
        runStartupChecks: runStartupChecks,
        getSessionId: getSessionId,
        handleTabRecovered: handleTabRecovered,
        isInitialising: isInitialising,
        isRecoveryMode: isRecoveryMode,
        recoverLostTabs: recoverLostTabs,
    };
}());

gsSession.runStartupChecks();
