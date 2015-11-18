/*global chrome, localStorage */
(function (window) {

    'use strict';

    var gsUtils = {

        SCREEN_CAPTURE: 'screenCapture',
        ONLINE_CHECK: 'onlineCheck',
        BATTERY_CHECK: 'batteryCheck',
        UNSUSPEND_ON_FOCUS: 'gsUnsuspendOnFocus',
        SUSPEND_TIME: 'gsTimeToSuspend',
        IGNORE_PINNED: 'gsDontSuspendPinned',
        IGNORE_FORMS: 'gsDontSuspendForms',
        IGNORE_AUDIO: 'gsDontSuspendAudio',
        IGNORE_CACHE: 'gsIgnoreCache',
        ADD_CONTEXT: 'gsAddContextMenu',
        NO_NAG: 'gsNoNag',
        THEME: 'gsTheme',
        WHITELIST: 'gsWhitelist',

        APP_VERSION: 'gsVersion',
        LAST_NOTICE: 'gsNotice',
        HISTORY_OLD: 'gsHistory',
        HISTORY: 'gsHistory2',
        SESSION_HISTORY: 'gsSessionHistory',

        DB_SERVER: 'tgs',
        DB_VERSION: '2',
        DB_PREVIEWS: 'gsPreviews',
        DB_SUSPENDED_TABINFO: 'gsSuspendedTabInfo',
        DB_CURRENT_SESSIONS: 'gsCurrentSessions',
        DB_SAVED_SESSIONS: 'gsSavedSessions',

        noop: function() {},

        getSettingsDefaults: function () {

            var defaults = {};
            defaults[this.SCREEN_CAPTURE] = '0';
            defaults[this.ONLINE_CHECK] = false;
            defaults[this.BATTERY_CHECK] = false;
            defaults[this.UNSUSPEND_ON_FOCUS] = false;
            defaults[this.IGNORE_PINNED] = true;
            defaults[this.IGNORE_FORMS] = true;
            defaults[this.IGNORE_AUDIO] = true;
            defaults[this.IGNORE_CACHE] = false;
            defaults[this.ADD_CONTEXT] = true;
            defaults[this.SUSPEND_TIME] = '60';
            defaults[this.NO_NAG] = false;
            defaults[this.WHITELIST] = '';
            defaults[this.THEME] = 'light';

            return defaults;
        },


       /**
        * LOCAL STORAGE FUNCTIONS
        */

        //due to migration issues and new settings being added, i have built in some redundancy
        //here so that getOption will always return a valid value.
        getOption: function (prop) {
            var settings = this.getSettings(),
                defaults;

            //test that option exists in settings object
            if (typeof(settings[prop]) === 'undefined' || settings[prop] === null) {
                defaults = this.getSettingsDefaults();
                this.setOption(prop, defaults[prop]);
                return defaults[prop];

            } else {
                return settings[prop];
            }
        },

        setOption: function (prop, value) {
            var settings = this.getSettings();
            settings[prop] = value;
            this.saveSettings(settings);
        },

        getSettings: function () {
            var settings = localStorage.getItem('gsSettings');
            if (settings !== null && settings !== 'null') {
                settings = JSON.parse(settings);

            } else {
                settings = this.getSettingsDefaults();
                this.saveSettings(settings);
            }
            return settings;
        },

        saveSettings: function (settings) {
            localStorage.setItem('gsSettings', JSON.stringify(settings));
        },

        checkWhiteList: function (url) {
            var whitelist = this.getOption(this.WHITELIST),
                whitelistItems = whitelist ? whitelist.split(/[\s\n]+/) : [],
                whitelisted;

            whitelisted = whitelistItems.some(function (item) {
                return this.testForMatch(item, url);
            }, this);
            return whitelisted;
        },

        removeFromWhitelist: function (url) {
            var whitelist = this.getOption(this.WHITELIST),
                whitelistItems = whitelist ? whitelist.split(/[\s\n]+/).sort() : '',
                i;

            for (i = whitelistItems.length - 1; i >= 0; i--) {
                if (this.testForMatch(whitelistItems[i], url)) {
                    whitelistItems.splice(i, 1);
                }
            }
            this.setOption(this.WHITELIST, whitelistItems.join('\n'));
        },

        testForMatch: function (whitelistItem, word) {

            if (whitelistItem.length < 1) {
                return false;

            //test for regex ( must be of the form /foobar/ )
            } else if (whitelistItem.length > 2 &&
                    whitelistItem.indexOf('/') === 0 &&
                    whitelistItem.indexOf('/', whitelistItem.length - 1) !== -1) {

                whitelistItem = whitelistItem.substring(1, whitelistItem.length - 1);
                try {
                    new RegExp(whitelistItem);
                } catch(e) {
                    return false;
                }
                return new RegExp(whitelistItem).test(word);

            // test as substring
            } else {
                return word.indexOf(whitelistItem) >= 0;
            }
        },

        globStringToRegex: function (str) {
            return new RegExp(this.preg_quote(str).replace(/\\\*/g, '.*').replace(/\\\?/g, '.'), 'g');
        },
        preg_quote: function (str, delimiter) {
            return (str + '').replace(new RegExp('[.\\\\+*?\\[\\^\\]$(){}=!<>|:\\' + (delimiter || '') + '-]', 'g'), '\\$&');
        },

        saveToWhitelist: function (newString) {
            var whitelist = this.getOption(this.WHITELIST);
            whitelist = whitelist ? whitelist + '\n' + newString : newString;
            whitelist = this.cleanupWhitelist(whitelist);
            this.setOption(this.WHITELIST, whitelist);
        },

        cleanupWhitelist: function (whitelist) {
            var whitelistItems = whitelist ? whitelist.split(/[\s\n]+/).sort() : '',
                i,
                j;

            for (i = whitelistItems.length - 1; i >= 0; i--) {
                j = whitelistItems.lastIndexOf(whitelistItems[i]);
                if (j !== i) {
                    whitelistItems.splice(i + 1, j - i);
                }
            }
            if (whitelistItems.length) {
                return whitelistItems.join('\n');
            } else {
                return whitelistItems;
            }
        },

        fetchLastVersion: function () {
            var version = localStorage.getItem(this.APP_VERSION);
            if (version !== null) {
                version = JSON.parse(version);
                return version;
            } else {
                return 0;
            }
        },

        setLastVersion: function (newVersion) {
            localStorage.setItem(this.APP_VERSION, JSON.stringify(newVersion));
        },

        fetchNoticeVersion: function () {
            var result = localStorage.getItem(this.LAST_NOTICE);
            if (result !== null) {
                result = JSON.parse(result);
                return result;
            } else {
                return 0;
            }
        },

        setNoticeVersion: function (newVersion) {
            localStorage.setItem(this.LAST_NOTICE, JSON.stringify(newVersion));
        },


       /**
        * INDEXEDDB FUNCTIONS
        */

        getDb: function () {
            var self = this;
            return db.open({
                server: self.DB_SERVER,
                version: self.DB_VERSION,
                schema: self.getSchema
            });
        },

        getSchema: function () {
            return {
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
            };
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
            var self = this,
                server;
            this.getDb().then(function (s) {
                server = s;
                return server.query(self.DB_PREVIEWS , 'url')
                        .only(tabUrl)
                        .execute();

            }).then(function (results) {
                if (results.length > 0) {
                    server.update(self.DB_PREVIEWS , {id: results[0].id, url: tabUrl, img: previewUrl});

                } else {
                    server.add(self.DB_PREVIEWS , {url: tabUrl, img: previewUrl});
                }
            });
        },

        addSuspendedTabInfo: function (tabProperties, callback) {
            var self = this,
                server;

            if (!tabProperties.url) {
                console.log('tabProperties.url not set.');
                return;
            }

            //first check to see if tabProperties already exists
            this.getDb().then(function (s) {
                server = s;
                return server.query(self.DB_SUSPENDED_TABINFO).filter('url', tabProperties.url).execute();

            }).then(function(result) {
                if (result.length > 0) {
                    result = result[0];
                    //copy across id
                    tabProperties.id = result.id;
                    //then update based on that id
                    server.update(self.DB_SUSPENDED_TABINFO, tabProperties).then(function() {
                        if (typeof(callback) === "function") callback();
                    });
                } else {
                    server.add(self.DB_SUSPENDED_TABINFO, tabProperties).then(function() {
                        if (typeof(callback) === "function") callback();
                    });
                }
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

        updateSession: function (session, callback) {

            //if it's a saved session (prefixed with an underscore)
            var server,
                tableName = session.sessionId.indexOf('_') === 0
                    ? this.DB_SAVED_SESSIONS
                    : this.DB_CURRENT_SESSIONS;
            callback = typeof callback !== 'function' ? this.noop : callback;

            //first check to see if session id already exists
            this.getDb().then(function (s) {
                server = s;
                return server.query(tableName).filter('sessionId', session.sessionId).execute();

            }).then(function(result) {
                if (result.length > 0) {
                    result = result[0];
                    session.id = result.id; //copy across id from matching session
                    session.date = (new Date()).toISOString();
                    return server.update(tableName , session); //then update based on that id
                } else {
                    return server.add(tableName, session);
                }
            }).then(function(result) {
                if (result.length > 0) {
                    callback(result[0]);
                }
            });
        },

        fetchCurrentSessions: function () {
            var self = this;
            return this.getDb().then(function (s) {
                return s.query(self.DB_CURRENT_SESSIONS).all().desc().execute();
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

            //if sessionId does not already have an underscore prefix then generate a new unique sessionId for this saved session
            if (session.sessionId.indexOf('_') < 0) {
                session.sessionId = '_' + this.generateHashCode(session.name);
            }

            //clear id as it will be either readded (if sessionId match found) or generated (if creating a new session)
            delete session.id;

            this.updateSession(session);
        },

        clearGsSessions: function () {
            var self = this;

            this.getDb().then(function (s) {
                s.clear(self.DB_CURRENT_SESSIONS);
            });
        },

        clearTabInfo: function () {
            var self = this;

            this.getDb().then(function (s) {
                s.clear(self.DB_PREVIEWS);
                s.clear(self.DB_SUSPENDED_TABINFO);
            });
        },

        removeTabFromSessionHistory: function (sessionId, windowId, tabId, callback) {

            var self = this,
                matched;

            callback = typeof callback !== 'function' ? this.noop : callback;

            this.fetchSessionById(sessionId).then(function(gsSession) {

                gsSession.windows.some(function (curWindow, windowIndex) {
                    matched = curWindow.tabs.some(function (curTab, tabIndex) {
                    //leave this as a loose matching as sometimes it is comparing strings. other times ints
                        if (curTab.id == tabId || curTab.url == tabId) {
                            curWindow.tabs.splice(tabIndex, 1);
                            return true;
                        }
                    });
                    if (matched) {
                        //remove window if it no longer contains any tabs
                        if (curWindow.tabs.length === 0) {
                            gsSession.windows.splice(windowIndex, 1);
                        }
                        return true;
                    }
                });

                //update session
                if (gsSession.windows.length > 0) {
                    self.updateSession(gsSession, function(session) {
                        callback(session);
                    });

                //or remove session if it no longer contains any windows
                } else {
                    self.removeSessionFromHistory(sessionId, function(session) {
                        callback(false);
                    });
                }
            });
        },

        removeSessionFromHistory: function (sessionId, callback) {

            var server,
                session,
                tableName = sessionId.indexOf('_') === 0
                    ? this.DB_SAVED_SESSIONS
                    : this.DB_CURRENT_SESSIONS;

            callback = typeof callback !== 'function' ? this.noop : callback;

            this.getDb().then(function (s) {
                server = s;
                return server.query(tableName).filter('sessionId', sessionId).execute();

            }).then(function(result) {
                if (result.length > 0) {
                    session = result[0];
                    server.remove(tableName , session.id);
                }
            }).then(callback);
        },

        trimDbItems: function () {
            var self = this,
                server,
                maxTabItems = 1000,
                maxPreviewItems = 200,
                maxHistories = 5,
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

        generateSuspendedUrl: function (tabProperties) {
            var args = '#' +
                'ttl=' + encodeURIComponent(tabProperties.title) + '&' +
                // 'fav=' + encodeURIComponent(tab.favIconUrl) + '&' +
                'uri=' + (tabProperties.url);

            return chrome.extension.getURL('suspended.html' + args);
        },

        getHashVariable: function(key, urlStr) {

            var valuesByKey = {},
                keyPairRegEx = /^(.+)=(.+)/,
                hashStr;

            //extract hash component from url
            hashStr = urlStr.replace(/^[^#]+#(.*)/, '$1');

            if (hashStr.length === 0) {
                return false;
            }

            //remove possible # prefix
            hashStr = hashStr.replace(/^#(.*)/, '$1');

            //handle possible unencoded final var called 'uri'
            if (hashStr.indexOf('uri=') >= 0) {
                valuesByKey.uri = hashStr.split('uri=')[1];
                hashStr = hashStr.split('uri=')[0];
            }

            hashStr.split('&').forEach(function (keyPair) {
                if (keyPair && keyPair.match(keyPairRegEx)) {
                    valuesByKey[keyPair.replace(keyPairRegEx, '$1')] = keyPair.replace(keyPairRegEx, '$2');
                }
            });
            return valuesByKey[key] || false;
        },
        getSuspendedTitle: function(urlStr) {
            return decodeURIComponent(this.getHashVariable('ttl', urlStr) || '');
        },
        getSuspendedUrl: function (urlStr) {
            return this.getHashVariable('uri', urlStr);
        },

        htmlEncode: function (text) {
            return document.createElement('pre').appendChild(document.createTextNode(text)).parentNode.innerHTML;
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

        getChromeVersion: function () {
            var raw = navigator.userAgent.match(/Chrom(e|ium)\/([0-9]+)\./);
            return raw ? parseInt(raw[2], 10) : false;
        },

        generateHashCode: function (text) {
            var hash = 0, i, chr, len;
            if (text.length == 0) return hash;
            for (i = 0, len = text.length; i < len; i++) {
                chr   = text.charCodeAt(i);
                hash  = ((hash << 5) - hash) + chr;
                hash |= 0; // Convert to 32bit integer
            }
            return Math.abs(hash);
        },

        getRootUrl: function (url) {
            var rootUrlStr;

            url = url || '';
            if (url.indexOf('suspended.html') > 0) {
                url = gsUtils.getSuspendedUrl(url);
            }

            rootUrlStr = url;
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

            var self = this,
                tgs = chrome.extension.getBackgroundPage().tgs,
                tabIdMap = {},
                tabUrlMap = {},
                suspendedUrl,
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
                    if (!tgs.isSpecialTab(sessionTab)
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
                chrome.windows.create({url: tabUrls, focused: false});
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

        performNewMigration: function (oldVersion) {

            var self = this,
                server;

            oldVersion = parseFloat(oldVersion);

            //perform migrated history fixup
            if (oldVersion < 6.13) {

                //fix up migrated saved session and newly saved session sessionIds
                this.getDb().then(function (s) {
                    server = s;
                    return s.query(self.DB_SAVED_SESSIONS).all().execute();

                }).then(function (savedSessions) {
                    savedSessions.forEach(function (session, index) {
                        if (session.id === 7777) {
                            session.sessionId = "_7777";
                            session.name = "Recovered tabs";
                            session.date = (new Date(session.date)).toISOString();
                        } else {
                            session.sessionId = '_' + self.generateHashCode(session.name);
                        }
                        server.update(self.DB_SAVED_SESSIONS , session);
                    });
                });
            }
            if (oldVersion < 6.30) {

                if (this.getOption('preview')) {
                    if (this.getOption('previewQuality') === '0.1') {
                        this.setOption(this.SCREEN_CAPTURE, '1');
                    } else {
                        this.setOption(this.SCREEN_CAPTURE, '2');
                    }
                } else {
                    this.setOption(this.SCREEN_CAPTURE, '0');
                }
            }
        },

        performOldMigration: function (oldVersion, callback) {

            var self = this,
                settings,
                gsHistory,
                chromeHistory,
                oldGsHistory,
                sessionHistory,
                currentSessions = [],
                savedSessions = [],
                previews = [],
                key;

            callback = typeof callback !== 'function' ? this.noop : callback;
            oldVersion = parseFloat(oldVersion);

            //migrate settings
            if (oldVersion < 5) {
                this.performSettingsMigration();
            }

            //prepare sessionHistory and suspendedTabInfo for migration to indexedDb
            this.fetchChromeHistory().then(function (chromeHistory) {

                //fetch gsHistory
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
                localStorage.removeItem(self.HISTORY);

                //if pre v5.0 then populate recentSessions and savedSessions from chrome history
                if (oldVersion < 5) {
                    sessionHistory = self.migrateSessionHistory(self, chromeHistory, gsHistory);
                    currentSessions = sessionHistory['currentSessions'];
                    savedSessions = sessionHistory['savedSessions'];

                //otherwise separate more recent session history construct into recentSessions and savedSessions
                } else {

                    sessionHistory = localStorage.getItem(self.SESSION_HISTORY);
                    if (sessionHistory) {
                        sessionHistory = JSON.parse(sessionHistory);
                        sessionHistory.forEach(function (curSession, curIndex) {

                            curSession.sessionId = curSession.id + "";
                            delete curSession.id;

                            if (!curSession.name) {
                                currentSessions.push(curSession);
                            } else {
                                savedSessions.push(curSession);
                            }
                        });
                    }
                }
                localStorage.removeItem(self.SESSION_HISTORY);

                //fetch new indexedDb server
                return self.getDb();


            //migrate gsHistory and gsPreviews to indexedDb tabInfo
            }).then(function (server) {

                //migrate suspendedTabInfo
                if (gsHistory.length > 0) {
                    server.add(self.DB_SUSPENDED_TABINFO, gsHistory);
                }

                //migrate gsCurrentSessions and gsSavedSessions
                if (currentSessions.length > 0) {
                    server.add(self.DB_CURRENT_SESSIONS, currentSessions);
                }
                if (savedSessions.length > 0) {
                    server.add(self.DB_SAVED_SESSIONS, savedSessions);
                }


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
                callback();
            });
        },

        compareDate: function (a, b) {
            if (a.date < b.date)  return -1;
            if (a.date > b.date) return 1;
            return 0;
        },
        formatDateForSessionTitle: function (date, includeTime) {
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
        getTabFromWindow: function (id, window) {
            var tab = false;
            window.tabs.some(function (curTab) {
                //leave this as a loose matching as sometimes it is comparing strings. other times ints
                if (curTab.id == id || curTab.url == id) {
                    tab = curTab;
                    return true;
                }
            });
            return tab;
        },

        performSettingsMigration: function () {

            var key,
                settings = {},
                defaults = this.getSettingsDefaults();

            for (key in defaults) {
                if (defaults.hasOwnProperty(key)) {
                    if (typeof(localStorage.getItem(key)) !== 'undefined' && localStorage.getItem(key) !== null) {
                        settings[key] = localStorage.getItem(key);
                        localStorage.removeItem(key);
                    } else {
                        settings[key] = defaults[key];
                    }
                }
            }

            //finally, store settings on local storage for synchronous access
            localStorage.setItem('gsSettings', JSON.stringify(settings));
        },

        fetchChromeHistory: function () {
            return new Promise(function(resolve, reject) {

                var extId = chrome.runtime.id;
                chrome.history.search({text: extId, maxResults: 1000}, function(results) {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                    } else {
                        resolve(results);
                    }
                });
            });
        },

        migrateSessionHistory: function (self, chromeHistory, gsHistory) {

            var tabId,
                tabTitle,
                tabSuspendedUrl,
                tabOriginalUrl,
                tabHistoryDate,
                currentSessions = [],
                savedSessions = [],
                chromeTabsWindow,
                tgsTabsWindow,
                curSession,
                curWindow,
                curTab,
                groupKey,
                lastGroupKey = false,
                tabProperties,
                count = 1,
                groupCount = 0;


            //first recover from chrome://history
             chromeTabsWindow = {
                id: 7777,
                tabs: []
            };

            chromeHistory.forEach(function (tab) {

                if (tab.url.indexOf('suspended.html') < 0) return;

                tabId = parseInt(tab.id);
                tabSuspendedUrl = tab.url;
                tabOriginalUrl = self.getSuspendedUrl(tab.url);
                tabTitle = tabOriginalUrl.split('//')[1];
                tabHistoryDate = new Date(tab.lastVisitTime);

                tabProperties = {
                    active: false,
                    favIconUrl: 'chrome://favicon/' + tabOriginalUrl,
                    height: 600,
                    highlighted: false,
                    id: tabId,
                    incognito: false,
                    index: count,
                    pinned: false,
                    selected: false,
                    status: "complete",
                    title: tabOriginalUrl,
                    url: tabSuspendedUrl,
                    width: 800,
                    windowId: 7777
                }

                groupKey = self.formatDateForSessionTitle(tabHistoryDate, false);
                if (lastGroupKey !== groupKey) {
                    groupCount++;
                }

                //only save the last 5 sessions
                if (groupCount <= 5) {

                    //if we are on the first tab for a new date
                    if (lastGroupKey !== groupKey) {
                        curSession = {sessionId: groupKey, windows: [], date: tabHistoryDate};
                        currentSessions.unshift(curSession);
                    }
                    lastGroupKey = groupKey;

                    curWindow = self.getWindowFromSession(tabProperties.windowId, curSession);
                    if (!curWindow) {
                        curWindow = {id: tabProperties.windowId, tabs: []};
                        curSession.windows.push(curWindow);
                    }

                    curTab = self.getTabFromWindow(tabProperties.url, curWindow);
                    if (!curTab) {
                        curWindow.tabs.push(tabProperties);
                    }
                }

                curTab = self.getTabFromWindow(tabProperties.url, chromeTabsWindow);
                if (!curTab) {
                    chromeTabsWindow.tabs.push(tabProperties);
                }
                count++;
            });

            savedSessions.push({sessionId: "_7777", name: "Chrome history", windows: [chromeTabsWindow], date: (new Date()).toISOString()});


            //then recover from gsHistory
            tgsTabsWindow = {
                id: 7778,
                tabs: []
            };

            gsHistory.sort(self.compareDate);
            gsHistory.forEach(function (tabProperties) {

                //convert all tab urls into suspended urls
                tabProperties.url = self.generateSuspendedUrl(tabProperties);

                curTab = self.getTabFromWindow(tabProperties.url, tgsTabsWindow);
                if (!curTab) {
                    tgsTabsWindow.tabs.push(tabProperties);
                }
            });

            savedSessions.push({sessionId: "_7778", name: "Extension history", windows: [tgsTabsWindow], date: (new Date()).toISOString()});

            return {
                'currentSessions': currentSessions,
                'savedSessions': savedSessions
            };
        }
    };

    window.gsUtils = gsUtils;

}(window));
