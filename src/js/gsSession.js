/*global chrome, localStorage, tgs, db, gsStorage, gsUtils, gsMessages, gsAnalytics */
var gsSession = (function () { // eslint-disable-line no-unused-vars
    'use strict';

    var browserStartupTimestamp;
    var sessionId;

    chrome.runtime.onStartup.addListener(function () {
        browserStartupTimestamp = Date.now();
        gsUtils.log('\n\n\nSTARTUP!!!!! ' + browserStartupTimestamp + '\n\n\n');
    });

    //handle special event where an extension update is available
    chrome.runtime.onUpdateAvailable.addListener(function (details) {
        prepareForUpdate(details);
    });

    function prepareForUpdate(newVersionDetails) {

        var currentVersion = chrome.runtime.getManifest().version;
        var newVersion = newVersionDetails.version;

        gsUtils.log('A new version is available: ' + currentVersion + ' -> ' + newVersion);

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
            gsUtils.log('sessionId: ', sessionId);
        }
        return sessionId;
    }

    function backgroundScriptsReadyAsPromsied() {
        return new Promise(function (resolve) {
            var isReady = chrome.extension.getBackgroundPage() &&
                typeof db !== 'undefined' &&
                typeof gsStorage !== 'undefined' &&
                typeof gsMessages !== 'undefined' &&
                typeof gsUtils !== 'undefined' &&
                typeof gsAnalytics !== 'undefined';
            console.log('isReady',isReady);
            resolve(isReady);
        }).then(function (isReady) {
            if (isReady) {
                return Promise.resolve();
            }
            return new Promise(function (resolve) {
                window.setTimeout(resolve, 50);
            }).then(backgroundScriptsReadyAsPromsied);
        });
    }

    function runStartupChecks() {
        backgroundScriptsReadyAsPromsied().then(function () {
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
                        checkForCrashRecovery(true);

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
                checkForCrashRecovery(false);

                //trim excess dbItems
                gsStorage.trimDbItems();
            }

            //inject new content script into all open pages
            reinjectContentScripts();

            //add context menu items
            var contextMenus = gsStorage.getOption(gsStorage.ADD_CONTEXT);
            tgs.buildContextMenu(contextMenus);

            //initialise globalCurrentTabId (important that this comes last. cant remember why?!?!)
            tgs.init();

            //initialise settings (important that this comes last. cant remember why?!?!)
            gsStorage.initSettings();
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

    function checkForCrashRecovery(isUpdating) {
        gsUtils.log('\n\n\nCRASH RECOVERY CHECKS!!!!! ' + Date.now() + '\n\n\n');

        //try to detect whether the extension has crashed as separate to chrome crashing
        //if it is just the extension that has crashed, then in theory all suspended tabs will be gone
        //and all normal tabs will still exist with the same ids

        var suspendedTabCount = 0,
            unsuspendedTabCount = 0,
            suspendedTabs = [],
            tabResponses = [],
            unsuspendedSessionTabs = [],
            currentlyOpenTabs = [];


        var isBrowserStarting = browserStartupTimestamp && (Date.now() - browserStartupTimestamp) < 5000;
        gsUtils.log('browserStartupTimestamp', browserStartupTimestamp);
        gsUtils.log('isBrowserStarting', isBrowserStarting);
        gsUtils.log('Checking for crash recovery');

        if (isBrowserStarting && !isUpdating) {
            gsUtils.log('Aborting tab recovery. Browser is starting..');
            return;
        }

        gsStorage.fetchLastSession().then(function (lastSession) {

            if (!lastSession) {
                return;
            }
            gsUtils.log('lastSession: ', lastSession);

            //collect all nonspecial, unsuspended tabs from the last session
            lastSession.windows.forEach(function (sessionWindow) {
                sessionWindow.tabs.forEach(function (sessionTab) {

                    if (!gsUtils.isSpecialTab(sessionTab)) {
                        if (!gsUtils.isSuspendedTab(sessionTab, true)) {
                            unsuspendedSessionTabs.push(sessionTab);
                            unsuspendedTabCount++;
                        } else {
                            suspendedTabCount++;
                        }
                    }
                });
            });

            //don't attempt recovery if last session had no suspended tabs
            if (suspendedTabCount === 0) {
                gsUtils.log('Aborting tab recovery. Last session has no suspended tabs.');
                return;
            }

            //check to see if they still exist in current session
            chrome.tabs.query({}, function (tabs) {

                gsUtils.log('Tabs in current session: ', tabs);
                gsUtils.log('Unsuspended session tabs: ', unsuspendedSessionTabs);

                /* TODO: Find a way to identify a browser restart to distinguish it from a normal extension crash.
                 * Unfortunately, we cant rely on chrome.runtime.onStartup as it may fire after this code
                 * has already run. The code below is a fallback test for browser startup.
                 */
                //don't attempt recovery if there are less tabs in current session than there were
                //unsuspended tabs in the last session
                if (tabs.length < unsuspendedTabCount) {
                    gsUtils.log('Aborting tab recovery. Last session contained ' + unsuspendedTabCount +
                            'tabs. Current session only contains ' + tabs.length);
                    return;
                }

                //if there is only one currently open tab and it is the 'new tab' page then abort recovery
                if (tabs.length === 1 && tabs[0].url === 'chrome://newtab/') {
                    gsUtils.log('Aborting tab recovery. Current session only contains a single newtab page.');
                    return;
                }

                //check for suspended tabs and try to contact them
                tabs.forEach(function (curTab) {
                    currentlyOpenTabs[curTab.id] = curTab;

                    //test if a suspended tab has crashed by sending a 'requestInfo' message
                    if (!gsUtils.isSpecialTab(curTab) && gsUtils.isSuspendedTab(curTab, true)) {
                        suspendedTabs.push(curTab);
                        gsMessages.sendPingToTab(curTab.id, function (err) {
                            if (err) {
                                gsUtils.log('Could not make contact with tab: ' + curTab.id + '. Assuming tab has crashed.');
                            } else {
                                tabResponses[curTab.id] = true;
                            }
                        });
                    }
                });

                //after 5 seconds, try to reload any suspended tabs that haven't respond for whatever reason (usually because the tab has crashed)
                if (suspendedTabs.length > 0) {
                    setTimeout(function () {
                        suspendedTabs.forEach(function (curTab) {
                            if (typeof tabResponses[curTab.id] === 'undefined') {

                                //automatically reload unresponsive suspended tabs
                                chrome.tabs.reload(curTab.id);
                            }
                        });
                    }, 5000);

                    //don't attempt recovery if there are still suspended tabs open
                    gsUtils.log('Will not attempt recovery as there are still suspended tabs open.');
                    return;
                }

                var lastExtensionRecoveryTimestamp = gsStorage.fetchLastExtensionRecoveryTimestamp();
                var hasCrashedRecently = lastExtensionRecoveryTimestamp && (Date.now() - lastExtensionRecoveryTimestamp) < (1000*60*5);
                gsStorage.setLastExtensionRecoveryTimestamp(Date.now());

                //if we are doing an update, or this is the first recent crash, then automatically recover lost tabs
                if (isUpdating || !hasCrashedRecently) {
                    gsUtils.recoverLostTabs(null);

                //otherwise show the recovery page
                } else {
                    chrome.tabs.create({url: chrome.extension.getURL('recovery.html')});
                }
            });
        });
    }

    function reinjectContentScripts() {
        chrome.tabs.query({}, function (tabs) {
            tabs.forEach(function (currentTab) {
                if (!gsUtils.isSpecialTab(currentTab) && !gsUtils.isSuspendedTab(currentTab) && !gsUtils.isDiscardedTab(currentTab)) {
                    gsMessages.executeScriptOnTab(currentTab.id, 'js/contentscript.js', function (err) {
                        if (!err) {
                            var suspendTime = gsStorage.getOption(gsStorage.SUSPEND_TIME);
                            gsMessages.sendInitTabToContentScript(currentTab.id, false, false, null, suspendTime);
                        }
                    });
                }
            });
        });
    }

    return {
        runStartupChecks: runStartupChecks,
        getSessionId: getSessionId,
    };
}());

gsSession.runStartupChecks();
