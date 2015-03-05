/*global chrome, localStorage */
(function (window) {

    'use strict';

    var gsUtils = {

        SHOW_PREVIEW: 'preview',
        PREVIEW_QUALTIY: 'previewQuality',
        ONLINE_CHECK: 'onlineCheck',
        BATTERY_CHECK: 'onlineCheck',
        UNSUSPEND_ON_FOCUS: 'gsUnsuspendOnFocus',
        SUSPEND_TIME: 'gsTimeToSuspend',
        MAX_HISTORIES: 'gsMaxHistories',
        IGNORE_PINNED: 'gsDontSuspendPinned',
        IGNORE_FORMS: 'gsDontSuspendForms',
        IGNORE_CACHE: 'gsIgnoreCache',
        NO_NAG: 'gsNoNag',
        WHITELIST: 'gsWhitelist',

        APP_VERSION: 'gsVersion',
        HISTORY_OLD: 'gsHistory',
        HISTORY: 'gsHistory2',
        SESSION_HISTORY: 'gsSessionHistory',

        DB_SERVER: 'tgs',
        DB_VERSION: '1',
        DB_PREVIEWS: 'gsPreviews',
        DB_SUSPENDED_TABINFO: 'gsSuspendedTabInfo',
        DB_CURRENT_SESSIONS: 'gsCurrentSessions',
        DB_SAVED_SESSIONS: 'gsSavedSessions',


       /**
        * LOCAL STORAGE FUNCTIONS
        */

        initSettings: function () {
            var self = this,
                key,
                defaults = {},
                settings = self.getSettings() || {};

            //now populate from local store or defaults for any items not already populated (old way)
            defaults[self.SHOW_PREVIEW] = false;
            defaults[self.PREVIEW_QUALTIY] = false;
            defaults[self.ONLINE_CHECK] = false;
            defaults[self.BATTERY_CHECK] = false;
            defaults[self.UNSUSPEND_ON_FOCUS] = false;
            defaults[self.IGNORE_PINNED] = true;
            defaults[self.IGNORE_FORMS] = true;
            defaults[self.IGNORE_CACHE] = false;
            defaults[self.SUSPEND_TIME] = '60';
            defaults[self.NO_NAG] = false;
            defaults[self.MAX_HISTORIES] = 4;
            defaults[self.WHITELIST] = '';

            for (key in defaults) {
                if (defaults.hasOwnProperty(key) && (typeof(settings[key]) === 'undefined' || settings[key] === null)) {
                    settings[key] = typeof(localStorage.getItem(key)) !== 'undefined' && localStorage.getItem(key) !== null
                        ? localStorage.getItem(key)
                        : defaults[key];
                }
            }

            //finally, store settings on local storage for synchronous access
            localStorage.setItem('gsSettings', JSON.stringify(settings));

        },

        getOption: function (prop) {
            var settings = this.getSettings();
            if (typeof settings[prop] === 'boolean') {
                return settings[prop];
            }
            return settings[prop];
        },

        setOption: function (prop, value) {
            var settings = this.getSettings();
            settings[prop] = value;
            this.saveSettings(settings);
        },

        getSettings: function () {
            var result = localStorage.getItem('gsSettings');
            if (result !== null && result !== 'null') {
                result = JSON.parse(result);
            }
            return result;
        },

        saveSettings: function (settings) {
            localStorage.setItem('gsSettings', JSON.stringify(settings));
        },

        removeFromWhitelist: function (newString) {
            var whitelist = this.getOption(this.WHITELIST),
                whitelistedWords = whitelist ? whitelist.split(/[\s\n]+/).sort() : '',
                i;

            // .forEach() not desirable in this case AFAIK
            // TODO make sure of comment above this one
            for (i = 0; i < whitelistedWords.length; i += 1) {
                if (whitelistedWords[i] === newString) {
                    whitelistedWords.splice(i, 1);
                }
            }
            this.setOption(this.WHITELIST, whitelistedWords.join('\n'));
        },

        saveToWhitelist: function (newString) {
            var whitelist = this.getOption(this.WHITELIST) + '\n' + newString;
            whitelist = this.cleanupWhitelist(whitelist);
            this.setOption(this.WHITELIST, whitelist);
        },

        cleanupWhitelist: function (whitelist) {
            var whitelistedWords = whitelist ? whitelist.split(/[\s\n]+/).sort() : '',
                i,
                j;

            for (i = 0; i < whitelistedWords.length; i += 1) {
                j = whitelistedWords.lastIndexOf(whitelistedWords[i]);
                if (j !== i) {
                    whitelistedWords.splice(i + 1, j - i);
                }
            }

            return whitelistedWords.join('\n');
        },

        fetchVersion: function () {
            var result = localStorage.getItem(this.APP_VERSION);
            if (result !== null) {
                result = JSON.parse(result);
            }
            return result;
        },

        setVersion: function (newVersion) {
            localStorage.setItem(this.APP_VERSION, JSON.stringify(newVersion));
        },



       /**
        * INDEXEDDB FUNCTIONS
        */

        getDb: function () {
            var self = this;
            return db.open({
                server: self.DB_SERVER,
                version: self.DB_VERSION
            });
        },

        fetchPreviewImage: function (tabUrl, callback) {
            var self = this;
            callback = typeof callback !== 'function' ? this.noop : callback;

            this.getDb().then(function (s) {
                return s.query(self.DB_PREVIEWS , 'url')
                        .only(tabUrl)
                        .execute();

            }).then(function (results) {
                if (results.length > 0) {
                    callback(results[0]['img']);
                } else {
                    callback(null);
                }
            });
        },

        addPreviewImage: function (tabUrl, previewUrl) {
            var self = this;
            this.getDb().then(function (s) {
                s.add(self.DB_PREVIEWS , {url: tabUrl, img: previewUrl});
            });
        },

        addSuspendedTabInfo: function (tabProperties) {
            var self = this;

            if (!tabProperties.url) {
                console.log('tabProperties.url not set.');
                return;
            }

            this.getDb().then(function (s) {
                s.add(self.DB_SUSPENDED_TABINFO , tabProperties);
            });
        },

        fetchTabInfo: function (tabUrl) {
            var self = this;
            return this.getDb().then(function (s) {
                return s.query(self.DB_SUSPENDED_TABINFO , 'url' )
                        .only(tabUrl)
                        .distinct()
                        .desc()
                        .execute()
                        .then(function(results) {
                            return results.length > 0 ? results[0] : null;
                        });
            });
        },

        updateSession: function (session) {

            //if it's a saved session (prefixed with an underscore)
            var server,
                tableName = session.sessionId.indexOf('_') === 0
                    ? this.DB_SAVED_SESSIONS
                    : this.DB_CURRENT_SESSIONS;

            //first check to see if session id already exists
            this.getDb().then(function (s) {
                server = s;
                return server.query(tableName).filter('sessionId', session.sessionId).execute();

            }).then(function(result) {
                if (result.length > 0) {
                    result = result[0];
                    session.id = result.id; //copy across id from matching session
                    server.update(tableName , session); //then update based on that id
                } else {
                    server.add(tableName, session);
                }
            });
        },

        fetchCurrentSessions: function () {
            var self = this;
            return this.getDb().then(function (s) {
                return s.query(self.DB_CURRENT_SESSIONS).all().execute();
            });
        },

        fetchSessionById: function (sessionId) {

            //if it's a saved session (prefixed with an underscore)
            var tableName = sessionId.indexOf('_') === 0
                    ? this.DB_SAVED_SESSIONS
                    : this.DB_CURRENT_SESSIONS;

            return this.getDb().then(function (s) {
                return s.query(tableName, 'sessionId' )
                        .only(sessionId)
                        .distinct()
                        .desc()
                        .execute()
                        .then(function(results) {
                    return results.length > 0 ? results[0] : null;
                });
            });
        },

        fetchLastSession: function () {
            var self = this,
                currentSessionId,
                lastSession = null;

            currentSessionId = typeof(chrome.extension.getBackgroundPage) !== 'undefined'
                ? chrome.extension.getBackgroundPage().tgs.sessionId
                : '';

            return this.getDb().then(function (s) {
                return s.query(self.DB_CURRENT_SESSIONS, 'id')
                        .all()
                        .desc()
                        .execute()
                        .then(function(results) {

                    if (results.length > 0) {
                        results.some(function(curSession) {

                            //don't want to match on current session
                            if (curSession.sessionId !== currentSessionId) {
                                lastSession = curSession;
                                return true;
                            }
                        });
                        return lastSession;

                    } else {
                        return null;
                    }
                });
            });
        },

        fetchSavedSessions: function () {
            var self = this;
            return this.getDb().then(function (s) {
                return s.query(self.DB_SAVED_SESSIONS).all().execute();
            });
        },

        addToSavedSessions: function (session) {
            var self = this;
            //prefix sessionId with an underscore to prevent
            //duplicate keys across current and saved sessions
            if (session.sessionId.indexOf('_') < 0) {
                session.sessionId = '_' + session.sessionId;
            }
            this.getDb().then(function (s) {
                s.add(self.DB_SAVED_SESSIONS, session);
            });
        },

        clearGsSessions: function () {
            var self = this;

            this.getDb().then(function (s) {
                s.clear(self.DB_CURRENT_SESSIONS);
                s.clear(self.DB_SAVED_SESSIONS);
            });
        },

        removeTabFromSessionHistory: function (sessionId, windowId, tabId) {

            var self = this;

            this.fetchSessionById(sessionId).then(function(gsSession) {

                gsSession.windows.some(function (curWindow, windowIndex) {
                    curWindow.tabs.some(function (curTab, tabIndex) {
                    //leave this as a loose matching as sometimes it is comparing strings. other times ints
                        if (curTab.id == tabId || curTab.url == tabId) {
                            curWindow.tabs.splice(tabIndex, 1);
                        }
                    });
                    //remove window if it no longer contains any tabs
                    if (curWindow.tabs.length === 0) {
                        gsSession.windows.splice(windowIndex, 1);
                    }
                });

                gsSession.date = new Date();
                self.updateSession(gsSession);
            });
        },

        trimDbItems: function () {
            var self = this,
                server,
                maxTabItems = 500,
                maxPreviewItems = 500,
                maxHistories = this.getOption(this.MAX_HISTORIES),
                itemsToRemove,
                i;

            this.getDb().then(function (s) {
                server = s;
                return server.query(self.DB_SUSPENDED_TABINFO, 'id')
                    .all()
                    .keys()
                    .execute();

            //trim suspendedTabInfo
            }).then(function (results) {

                //if there are more than maxTabItems items, then remove the oldest ones
                if (results.length > maxTabItems) {
                    itemsToRemove = results.length - maxTabItems;
                    for (i = 0; i < itemsToRemove; i++) {
                        server.remove(self.DB_SUSPENDED_TABINFO, results[i]);
                    }
                }

                return server.query(self.DB_PREVIEWS, 'id')
                    .all()
                    .keys()
                    .execute();

            //trim imagePreviews
            }).then(function (results) {

                //if there are more than maxPreviewItems items, then remove the oldest ones
                if (results.length > maxPreviewItems) {
                    itemsToRemove = results.length - maxPreviewItems;
                    for (i = 0; i < itemsToRemove; i++) {
                        server.remove(self.DB_PREVIEWS, results[i]);
                    }
                }

                return server.query(self.DB_CURRENT_SESSIONS, 'id')
                    .all()
                    .keys()
                    .execute();

            //trim currentSessions
            }).then(function (results) {

                //if there are more than maxHistories items, then remove the oldest ones
                if (results.length > maxHistories) {
                    itemsToRemove = results.length - maxHistories;
                    for (i = 0; i < itemsToRemove; i++) {
                        server.remove(self.DB_CURRENT_SESSIONS, results[i]);
                    }
                }
            });
        },



       /**
        * HELPER FUNCTIONS
        */

        //turn this into a string to make comparisons easier further down the track
        generateSessionId: function () {
            return Math.floor(Math.random() * 1000000) + "";
        },

        generateSuspendedUrl: function (tabUrl, useBlank) {
            var args = '#uri=' + tabUrl;//encodeURIComponent(tabUrl);
            useBlank = useBlank || false;

            if (useBlank) {
                return chrome.extension.getURL('clean.html');
            } else {
                return chrome.extension.getURL('suspended.html' + args);
            }
        },

        getSuspendedUrl: function (hash) {
            var url,
                re = /%[0-9a-f]{2}/i;

            //remove possible # prefix
            if (hash && hash.substring(0,1) === '#') {
                hash = hash.substring(1,hash.length);
            }

            //if it is an old style url encoded hash
            if (hash.length > 0 && hash.indexOf('url=') === 0) {
                url = hash.substring(4,hash.length);
                if (re.exec(url) !== null) {
                    return decodeURIComponent(url);
                } else {
                    return url;
                }

            //if it is a new unencoded hash
            } else if (hash.length > 0 && hash.indexOf('uri=') === 0) {
                return hash.substring(4,hash.length);

            } else {
                return false;
            }
        },

        getFormattedDate: function (date, includeTime) {
            var d = new Date(date),
                cur_date = ('0' + d.getDate()).slice(-2),
                cur_month = ('0' + (d.getMonth() + 1)).slice(-2),
                cur_year = d.getFullYear(),
                cur_time = d.toTimeString().match(/^([0-9]{2}:[0-9]{2})/)[0];

            if (includeTime) {
                return cur_date + '-' + cur_month + '-' + cur_year + ': ' + cur_time;
            }
            return cur_date + '-' + cur_month + ' ' + cur_year;
        },

        getHumanDate: function (date) {
            var m_names = ['January', 'February', 'March', 'April', 'May',
                'June', 'July', 'August', 'September', 'October', 'November',
                'December'],
                d = new Date(date),
                curr_date = d.getDate(),
                sup,
                curr_month = d.getMonth(),
                curr_year = d.getFullYear();

            if (curr_date === 1 || curr_date === 21 || curr_date === 31) {
                sup = 'st';
            } else if (curr_date === 2 || curr_date === 22) {
                sup = 'nd';
            } else if (curr_date === 3 || curr_date === 23) {
                sup = 'rd';
            } else {
                sup = 'th';
            }

            return curr_date + sup + ' ' + m_names[curr_month] + ' ' + curr_year;
        },

        getRootUrl: function (url) {
            var rootUrlStr = url;

            // TODO make sure this works
            if (rootUrlStr.indexOf('//') > 0) {
                rootUrlStr = rootUrlStr.substring(rootUrlStr.indexOf('//') + 2);
            } else {
                rootUrlStr = url;
            }
            rootUrlStr = rootUrlStr.substring(0, rootUrlStr.indexOf('/'));

            return rootUrlStr;
        },

        recoverLostTabs: function (callback) {

            var self = this,
                tabMap = {},
                windowsMap = {};

            callback = typeof callback !== 'function' ? this.noop : callback;

            this.fetchLastSession().then(function (lastSession) {

                if (!lastSession) {
                    callback(null);
                }

                chrome.windows.getAll({ populate: true }, function (windows) {
                    windows.forEach(function (curWindow) {
                        curWindow.tabs.forEach(function (curTab) {
                            tabMap[curTab.id] = curTab;
                        });
                        windowsMap[curWindow.id] = tabMap;
                    });

                    //attempt to automatically restore any lost tabs/windows in their proper positions
                    lastSession.windows.forEach(function (sessionWindow) {
                        self.recoverWindow(sessionWindow, windowsMap, tabMap);
                    });

                    callback();
                });
            });
        },

        recoverWindow: function (sessionWindow, windowsMap, tabMap) {

            var tabIdMap = {},
                tabUrlMap = {},
                openTab;

            //if crashed window exists in current session then restore suspended tabs in that window
            if (windowsMap[sessionWindow.id]) {
                tabIdMap = windowsMap[sessionWindow.id];

                //get a list of unsuspended urls already in the window
                for (var id in tabIdMap) {
                    if (tabIdMap.hasOwnProperty(id)) {
                        openTab = tabIdMap[id];
                        tabUrlMap[openTab.url] = openTab;
                    }
                }

                sessionWindow.tabs.forEach(function (sessionTab) {

                    //if current tab does not exist then recreate it
                    if (!chrome.extension.getBackgroundPage().tgs.isSpecialTab(sessionTab)
                            && !tabUrlMap[sessionTab.url] && !tabIdMap[sessionTab.id]) {
                        chrome.tabs.create({
                            windowId: sessionWindow.id,
                            url: sessionTab.url,
                            index: sessionTab.index,
                            pinned: sessionTab.pinned,
                            active: false
                        });
                    }
                });

            //else restore entire window
            } else if (sessionWindow.tabs.length > 0) {

                //create list of urls to open
                var tabUrls = [];
                sessionWindow.tabs.forEach(function (sessionTab) {
                    tabUrls.push(sessionTab.url);
                });
                chrome.windows.create({url: tabUrls}, function(newWindow) {});
            }
        },

        getWindowFromSession: function (windowId, session) {
            var window = false;
            session.windows.some(function (curWindow) {
                //leave this as a loose matching as sometimes it is comparing strings. other times ints
                if (curWindow.id == windowId) {
                    window = curWindow;
                    return true;
                }
            });
            return window;
        },

        getTabFromWindow: function (id, window) {
            var tab = false;
            window.tabs.some(function (curTab) {
                //leave this as a loose matching as sometimes it is comparing strings. other times ints
                if (curTab.id == id || tab.url == id) {
                    tab = curTab;
                    return true;
                }
            });
            return tab;
        },

        saveWindowsToSessionHistory: function (sessionId, windowsArray) {
            var session = {
                sessionId: sessionId,
                windows: windowsArray,
                date: new Date()
            };
            this.updateSession(session);
        },



       /**
        * MIGRATIONS
        */

        performMigration: function (oldVersion) {

            var self = this,
                gsHistory,
                oldGsHistory,
                sessionHistory,
                currentSessions = [],
                savedSessions = [],
                previews = [],
                key;

            oldVersion = parseFloat(oldVersion);

            //create indexedDb database
            this.initialiseIndexedDb().then(function (server) {


                //migrate gsHistory to indexedDb tabInfo
                gsHistory = localStorage.getItem(self.HISTORY);
                gsHistory = gsHistory ? JSON.parse(gsHistory) : [];

                if (oldVersion < 5) {

                    //check for very old history migration
                    oldGsHistory = localStorage.getItem(self.HISTORY_OLD);
                    if (oldGsHistory !== null) {
                        oldGsHistory = JSON.parse(oldGsHistory);

                        //merge old gsHistory with new one
                        oldGsHistory.forEach(function (val, index, array) {
                            gsHistory.push(array[index]);
                        });
                        localStorage.removeItem(self.HISTORY_OLD);
                    }
                }
                if (gsHistory.length > 0) {
                    server.add(self.DB_SUSPENDED_TABINFO, gsHistory);
                }
                localStorage.removeItem(self.HISTORY);


                //migrate gsSessionHistory to indexedDb gsCurrentSessions and gsSavedSessions
                if (oldVersion < 5) {
                    sessionHistory = convertGsHistoryToSessionHistory(self, gsHistory);
                    currentSessions = sessionHistory['currentSessions'];
                    savedSessions = sessionHistory['savedSessions'];

                } else {

                    sessionHistory = localStorage.getItem(self.SESSION_HISTORY);
                    if (sessionHistory) {
                        sessionHistory = JSON.parse(sessionHistory);
                        sessionHistory.forEach(function (curSession, curIndex) {
                            if (!curSession.name) {
                                currentSessions.push(curSession);
                            } else {
                                savedSessions.push(curSession);
                            }
                        });
                    }
                }
                if (currentSessions.length > 0) {
                    server.add(self.DB_CURRENT_SESSIONS, currentSessions);
                }
                if (savedSessions.length > 0) {
                    server.add(self.DB_SAVED_SESSIONS, savedSessions);
                }
                localStorage.removeItem(self.SESSION_HISTORY);


                //migrate screen previews
                chrome.storage.local.get(null, function (items) {
                    if (typeof(items.gsPreviews) !== 'undefined') {

                        for (key in items.gsPreviews) {
                            if (items.gsPreviews.hasOwnProperty(key)) {

                                previews.push({
                                    url: key,
                                    img: items.gsPreviews[key]
                                });
                            }
                        }
                        if (previews.length > 0) {
                            server.add(self.DB_PREVIEWS , previews);
                        }
                        chrome.storage.local.clear();
                    }
                });
            });
        },

        compareDate: function (a, b) {
            if (a.date < b.date)  return -1;
            if (a.date > b.date) return 1;
            return 0;
        },
        convertGsHistoryToSessionHistory: function (self, gsHistory) {

            var currentSessions = [],
                savedSessions = [],
                allTabsWindow,
                curSession,
                curWindow,
                curTab,
                groupKey,
                lastGroupKey = false;

            allTabsWindow = {
                id: 7777,
                tabs: []
            };

            gsHistory.sort(self.compareDate);

            //approximate sessions from old suspended tab history data
            gsHistory.forEach(function (tabProperties) {

                groupKey = self.getFormattedDate(tabProperties.date, false);

                //if we are on the first tab for a new date
                if (lastGroupKey !== groupKey) {
                    curSession = {id: groupKey, windows: [], date: tabProperties.date};
                    currentSessions.unshift(curSession);
                }
                lastGroupKey = groupKey;

                curWindow = self.getWindowFromSession(tabProperties.windowId, curSession);
                if (!curWindow) {
                    curWindow = {id: tabProperties.windowId, tabs: []};
                    curSession.windows.unshift(curWindow);
                }

                curTab = self.getTabFromWindow(tabProperties.url, curWindow);
                if (!curTab) {
                    curWindow.tabs.unshift(tabProperties);
                }
                allTabsWindow.tabs.unshift(tabProperties);
            });

            savedSessions.push({id: 7777, windows: [allTabsWindow], date: new Date()});

            return {
                'currentSessions': currentSessions,
                'savedSessions': savedSessions
            };
        },

        initialiseIndexedDb: function () {

            var self = this;

            return db.open({
                server: self.DB_SERVER,
                version: self.DB_VERSION,
                schema: {
                    gsPreviews: {
                        key: {
                            keyPath: 'id',
                            autoIncrement: true
                        },
                        indexes: {
                            id: {},
                            url: {}
                        }
                    },
                    gsSuspendedTabInfo: {
                        key: {
                            keyPath: 'id',
                            autoIncrement: true
                        },
                        indexes: {
                            id: {},
                            url: {}
                        }
                    },
                    gsCurrentSessions: {
                        key: {
                            keyPath: 'id',
                            autoIncrement: true
                        },
                        indexes: {
                            id: {},
                            sessionId: {}
                        }
                    },
                    gsSavedSessions: {
                        key: {
                            keyPath: 'id',
                            autoIncrement: true
                        },
                        indexes: {
                            id: {},
                            sessionId: {}
                        }
                    }
                }
            });
        }
    };

    window.gsUtils = gsUtils;

}(window));
