/*global chrome, localStorage */

(function (window) {

    'use strict';

    var gsUtils = {

        SHOW_PREVIEW: 'preview',
        PREVIEW_QUALTIY: 'previewQuality',
        ONLINE_CHECK: 'onlineCheck',
        UNSUSPEND_ON_FOCUS: 'gsUnsuspendOnFocus',
        SUSPEND_TIME: 'gsTimeToSuspend',
        MAX_HISTORIES: 'gsMaxHistories',
        IGNORE_PINNED: 'gsDontSuspendPinned',
        IGNORE_FORMS: 'gsDontSuspendForms',
        IGNORE_CACHE: 'gsIgnoreCache',
        TIDY_URLS: 'gsTidyUrls',
        NO_NAG: 'gsNoNag',
        WHITELIST: 'gsWhitelist',

        APP_VERSION: 'gsVersion',
        HISTORY_OLD: 'gsHistory',
        HISTORY: 'gsHistory2',
        SESSION_HISTORY: 'gsSessionHistory',
        SAVED_SESSIONS: 'gsSavedSessions',

        initSettings: function (fn) {
            var self = this,
                items = localStorage.getItem('gsSettings'),
                key,
                defaults = [],
                settings = {},
                migration = false;
            self.callback = fn;

            for (key in items) {
                if (items.hasOwnProperty(key)) {
                    settings[key] = items[key];
                }
            }

            //now populate from local store or defaults for any items not already populated (old way)
            defaults[self.SHOW_PREVIEW] = false;
            defaults[self.PREVIEW_QUALTIY] = false;
            defaults[self.ONLINE_CHECK] = false;
            defaults[self.UNSUSPEND_ON_FOCUS] = false;
            defaults[self.IGNORE_PINNED] = false;
            defaults[self.IGNORE_FORMS] = false;
            defaults[self.IGNORE_CACHE] = false;
            defaults[self.SUSPEND_TIME] = 0;
            defaults[self.TIDY_URLS] = false;
            defaults[self.NO_NAG] = false;
            defaults[self.MAX_HISTORIES] = 4;
            defaults[self.WHITELIST] = '';

            for (key in defaults) {
                if (defaults.hasOwnProperty(key) && (settings[key] === 'undefined' || settings[key] === null)) {
                    settings[key] = localStorage.getItem(key) !== 'undefined' && localStorage.getItem(key) !== null
                        ? localStorage.getItem(key)
                        : defaults[key];
                    migration = true;
                }
            }

            //if we had to populate any new fields then resave these to chrome.storage.sync
            /*
            if (migration) {
                chrome.storage.sync.set(settings, function () {
                    console.log('Settings migrated to chrome sync storage');
                });
            }
            */

            //finally, store settings on local storage for synchronous access
            localStorage.setItem('gsSettings', JSON.stringify(settings));

            self.callback();
        },

        getOption: function (prop) {
            var settings = this.getSettings();
            // TODO make sure this works
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
            if (result !== null) {
                result = JSON.parse(result);
            }
            return result;
        },

        saveSettings: function (settings) {
            /*
            chrome.storage.sync.set(settings, function () {
                console.log('Settings saved to chrome sync storage');
            });
            */
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

            // TODO is not clear on its function AT ALL
            // TODO refactor for loop? not sure if necessary
            for (i = 0; i < whitelistedWords.length; i += 1) {
                if ((j = whitelistedWords.lastIndexOf(whitelistedWords[i])) !== i) {
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

        fetchPreviewImage: function (tabUrl, callback) {
            chrome.storage.local.get(null, function (items) {
                if (items.gsPreviews === 'undefined') {
                    items.gsPreviews = {};
                    chrome.storage.local.set(items);
                    callback(null);
                } else if (items.gsPreviews[tabUrl] === 'undefined') {
                    callback(null);
                } else {
                    callback(items.gsPreviews[tabUrl]);
                }
            });
        },

        setPreviewImage: function (tabUrl, previewUrl) {
            chrome.storage.local.get(null, function (items) {
                if (items.gsPreviews === 'undefined') {
                    items.gsPreviews = {};
                }

                items.gsPreviews[tabUrl] = previewUrl;
                chrome.storage.local.set(items);
            });
        },

        clearPreviews: function () {
            chrome.storage.local.get(null, function (items) {
                items.gsPreviews = {};
                chrome.storage.local.set(items);
            });
        },

        fetchGsHistory: function () {
            var result = localStorage.getItem(this.HISTORY);

            if (result === null) {
                result = [];
            } else {
                result = JSON.parse(result);
            }

            return result;
        },

        setGsHistory: function (gsHistory) {
            localStorage.setItem(this.HISTORY, JSON.stringify(gsHistory));
        },

        clearGsHistory: function (gsHistory) {
            this.setGsHistory([]);
        },

        fetchTabFromHistory: function (tabUrl) {
            var gsHistory = this.fetchGsHistory();

            gsHistory.forEach(function (val) {
                if (val.url === tabUrl) {
                    return val;
                }
            });

            return false;
        },

        removeTabFromHistory: function (tabUrl) {
            var gsHistory = this.fetchGsHistory(),
                i;

            // .forEach() not desirable in this case AFAIK
            // TODO make sure of comment above this one
            for (i = 0; i < gsHistory.length; i += 1) {
                if (gsHistory[i].url === tabUrl) {
                    gsHistory.splice(i, 1);
                    break;
                }
            }
            localStorage.setItem(this.HISTORY, JSON.stringify(gsHistory));
        },

        removeTabFromSessionHistory: function (sessionId, windowId, tabId) {

            var gsSessionHistory = this.fetchGsSessionHistory(),
                i,
                j,
                k;

            // TODO iterative function for sure, for now leave as-is
            // cannot use .forEach() because of .splice() :(
            for (i = 0; i < gsSessionHistory.length; i += 1) {
                if (gsSessionHistory[i].id === sessionId) {

                    for (j = 0; j < gsSessionHistory[i].windows.length; j += 1) {
                        if (gsSessionHistory[i].windows[j].id === windowId) {

                            for (k = 0; k < gsSessionHistory[i].windows[j].tabs.length; k += 1) {
                                if (gsSessionHistory[i].windows[j].tabs[k].id === tabId
                                        || gsSessionHistory[i].windows[j].tabs[k].url === tabId) {
                                    gsSessionHistory[i].windows[j].tabs.splice(k, 1);
                                    break;
                                }
                            }
                        }
                        if (gsSessionHistory[i].windows[j].tabs.length === 0) {
                            gsSessionHistory[i].windows.splice(j, 1);
                        }
                    }
                }
                if (gsSessionHistory[i].windows.length === 0) {
                    gsSessionHistory.splice(i, 1);
                }
            }

            this.setGsSessionHistory(gsSessionHistory);
        },

        fetchGsSessionHistory: function () {
            var result = localStorage.getItem(this.SESSION_HISTORY),
                sessionHistory;

            if (result) {
                sessionHistory = JSON.parse(result);
            } else {
                sessionHistory = [];
            }

            return sessionHistory;
        },

        setGsSessionHistory: function (sessionHistory) {
            localStorage.setItem(this.SESSION_HISTORY, JSON.stringify(sessionHistory));
        },

        clearGsSessionHistory: function (gsHistory) {
            this.setGsSessionHistory([]);
        },

        getSessionById: function (sessionId) {
            var sessionHistory = this.fetchGsSessionHistory();
            sessionHistory.forEach(function (session) {
                if (session.id === sessionId) {
                    return session;
                }
            });

            sessionHistory = this.fetchGsSavedSessions();
            sessionHistory.forEach(function (session) {
                if (session.id === sessionId) {
                    return session;
                }
            });

            return false;
        },

        getWindowFromSession: function (windowId, session) {
            session.windows.forEach(function (window) {
                if (window.id === windowId) {
                    return window;
                }
            });
            return false;
        },

        getTabFromWindow: function (id, window) {
            window.tabs.forEach(function (tab) {
                if (tab.id === id || tab.url === id) {
                    return tab;
                }
            });
            return false;
        },

        saveWindowsToSessionHistory: function (sessionId, windowsArray) {
            var gsSessionHistory = this.fetchGsSessionHistory(),
                i,
                match = false;

            // best to leave this as-is because of break statement
            for (i = 0; i < gsSessionHistory.length; i += 1) {
                if (gsSessionHistory[i].id === sessionId) {
                    gsSessionHistory[i].windows = windowsArray;
                    gsSessionHistory[i].date = new Date();
                    match = true;
                    break;
                }
            }

            //if no matching window id found. create a new entry
            if (!match) {
                gsSessionHistory.unshift({
                    id: sessionId,
                    windows: windowsArray,
                    date: new Date()
                });
            }

            //trim stored windows down to last x sessions
            while (gsSessionHistory.length > this.getOption(this.MAX_HISTORIES)) {
                gsSessionHistory.splice(gsSessionHistory.length - 1, 1);
            }

            this.setGsSessionHistory(gsSessionHistory);
        },


        fetchGsSavedSessions: function () {
            var result = localStorage.getItem(this.SAVED_SESSIONS),
                savedSessionHistory;

            if (result) {
                savedSessionHistory = JSON.parse(result);
            } else {
                savedSessionHistory = [];
            }

            return savedSessionHistory;
        },

        setGsSavedSessions: function (savedSessionHistory) {
            localStorage.setItem(this.SAVED_SESSIONS, JSON.stringify(savedSessionHistory));
        },

        saveSession: function (sessionName, session) {
            var savedSessions = this.fetchGsSavedSessions();
            session.name = sessionName;
            savedSessions.unshift(session);
            this.setGsSavedSessions(savedSessions);
        },

        generateSessionId: function () {
            var sessionId = false;
            while (!sessionId) {
                sessionId = Math.floor(Math.random() * 1000000);
                if (this.getSessionById(sessionId)) {
                    sessionId = false;
                }
            }
            return sessionId;
        },

        generateSuspendedUrl: function (tabUrl, tabTitle) {
            var args = '#url=' + encodeURIComponent(tabUrl);
            return chrome.extension.getURL('suspended.html' + args);
        },

        getHashVariable: function (key, hash) {
            var parts,
                temp,
                i;

            if (hash.length === 0) {
                return false;
            }

            parts = hash.substring(1).split('&');
            for (i = 0; i < parts.length; i += 1) {
                temp = parts[i].split('=');
                if (temp[0] === key) {
                    return decodeURIComponent(temp[1]);
                }
            }
            return false;
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

        compareDate: function (a, b) {
            if (a.date < b.date) {
                return -1;
            }
            if (a.date > b.date) {
                return 1;
            }
            return 0;
        },

        getRootUrl: function (url) {
            var rootUrlStr;

            // TODO make sure this works
            if (rootUrlStr.indexOf('//') > 0) {
                rootUrlStr.substring(rootUrlStr.indexOf('//') + 2);
            } else {
                rootUrlStr = url;
            }
            rootUrlStr = rootUrlStr.substring(0, rootUrlStr.indexOf('/'));

            return rootUrlStr;
        },

        performMigration: function () {

            //migrate gsHistory to sessionHistory
            var gsHistory = this.fetchGsHistory(),
                oldGsHistory = localStorage.getItem(this.HISTORY_OLD),
                curSession,
                curWindow,
                curTab,
                groupKey,
                tabProperties,
                sessionHistory,
                allTabsWindow,
                //try restore any lost tabs (due to upgrade) from suspended tab history
                lastSession,
                sortable = [],
                url;

            //check for very old history migration
            if (oldGsHistory !== null) {
                oldGsHistory = JSON.parse(oldGsHistory);

                //merge old gsHistory with new one
                oldGsHistory.forEach(function (val, index, array) {
                    gsHistory.push(array[index]);
                });
                gsUtils.setGsHistory(gsHistory);
                localStorage.removeItem(this.HISTORY_OLD);
            }

            sessionHistory = [];
            allTabsWindow = {
                id: '0000',
                tabs: []
            };

            gsHistory.sort(this.compareDate);

            // TODO make sure this works
            gsHistory.forEach(function (entry) {
                tabProperties = entry;
                groupKey = this.getFormattedDate(tabProperties.date, false);

                // TODO isn't sessionHistory empty at this point because of some
                // lines up where it was defined as an empty array?
                sessionHistory.forEach(function (session) {
                    if (session.id === groupKey) {
                        curSession = session;
                    }
                });

                if (!curSession) {
                    curSession = {id: groupKey, windows: [], date: tabProperties.date};
                    sessionHistory.unshift(curSession);
                }

                curWindow = this.getWindowFromSession(tabProperties.windowId, curSession);
                if (!curWindow) {
                    curWindow = {id: tabProperties.windowId, tabs: []};
                    curSession.windows.unshift(curWindow);
                }

                curTab = this.getTabFromWindow(tabProperties.url, curWindow);
                if (!curTab) {
                    curWindow.tabs.unshift(tabProperties);
                }
                allTabsWindow.tabs.unshift(tabProperties);
            });

            //approximate new session history from old suspended tab history data
            this.setGsSessionHistory(sessionHistory);

            //save all old suspended tab history data as a saved session
            curSession = {id: '0000', windows: [allTabsWindow], date: new Date()};
            this.saveSession('Old suspended tab history', curSession);

            //if we have a valid last session
            if (sessionHistory.length > 0) {
                lastSession = sessionHistory[0];

                lastSession.forEach(function (curWindow) {
                    //sort tabs by index
                    curWindow.tabs.forEach(function (val) {
                        sortable.push([val, curWindow.tabs[val].index]);
                        sortable.sort(function (a, b) {
                            return a[1] - b[1];
                        });
                    });

                    sortable.forEach(function (val, index, array) {
                        curTab = curWindow.tabs[array[index][0]];

                        if (curTab.state === 'suspended') {
                            url = gsUtils.generateSuspendedUrl(curTab.url);
                            chrome.tabs.create({
                                url: url,
                                index: curTab.index,
                                pinned: curTab.pinned,
                                active: false
                            });
                        }
                    });
                });
            }

        }
    };

    window.gsUtils = gsUtils;

}(window));
