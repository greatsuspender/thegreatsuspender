/*global window, document, chrome, console, localStorage */

(function(window) {

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
        WHITELIST: 'gsWhitelist',

        APP_VERSION: 'gsVersion',
        HISTORY_OLD: 'gsHistory',
        HISTORY: 'gsHistory2',
        SESSION_HISTORY: 'gsSessionHistory',

        initSettings: function() {

            var self = this;

            chrome.storage.sync.get(null, function(items) {

                //first try to populate settings from the synced store
                var key,
                    defaults = [],
                    settings = {},
                    migration = false;

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
                defaults[self.MAX_HISTORIES] = 4;
                defaults[self.WHITELIST] = '';

                for (key in defaults) {
                    if (defaults.hasOwnProperty(key) && (typeof(settings[key]) === 'undefined' || settings[key] === null)) {
                        settings[key] = typeof(localStorage.getItem(key)) !== 'undefined' && localStorage.getItem(key) !== null
                            ? localStorage.getItem(key)
                            : defaults[key];
                        migration = true;
                    }
                }

                //if we had to populate any new fields then resave these to chrome.storage.sync
                if (migration) {
                    chrome.storage.sync.set(settings, function() {
                        console.log('Settings migrated to chrome sync storage');
                    });
                }

                //finally, store settings on local storage for synchronous access
                localStorage.setItem('gsSettings', JSON.stringify(settings));

            });
        },

        getOption: function(prop) {
            var settings = this.getSettings();
            if (settings[prop] === 'true') return true;
            if (settings[prop] === 'false') return false;
            return settings[prop];
        },

        setOption: function(prop, value) {
            var settings = this.getSettings();
            settings[prop] = value;
            this.saveSettings(settings);
        },

        getSettings: function() {
            var result = localStorage.getItem('gsSettings');
            if (result !== null) {
                result = JSON.parse(result);
            }
            return result;
        },

        saveSettings: function(settings) {
            chrome.storage.sync.set(settings, function() {
                console.log('Settings saved to chrome sync storage');
            });
            localStorage.setItem('gsSettings', JSON.stringify(settings));
        },






        saveToWhitelist: function(newString) {
            var whitelist = this.getOption(this.WHITELIST) + ' ' + newString;
            this.setOption(this.WHITELIST, whitelist);
        },

        fetchVersion: function() {
            return localStorage.getItem(this.APP_VERSION);
        },
        setVersion: function(newVersion) {
            localStorage.setItem(this.APP_VERSION, JSON.stringify(newVersion));
        },







        fetchPreviewImage: function(tabUrl, callback) {
            chrome.storage.local.get(null, function(items) {
                if (typeof (items.gsPreviews) === 'undefined') {
                    items.gsPreviews = {};
                    chrome.storage.local.set(items);
                    callback(null);

                } else if (typeof (items.gsPreviews[tabUrl]) === 'undefined') {
                    callback(null);

                } else {
                    callback(items.gsPreviews[tabUrl]);
                }
            });
        },

        setPreviewImage: function(tabUrl, previewUrl) {
            chrome.storage.local.get(null, function(items) {

                if (typeof (items.gsPreviews) === 'undefined') {
                    items.gsPreviews = {};
                }
                items.gsPreviews[tabUrl] = previewUrl;
                chrome.storage.local.set(items);
            });
        },

        clearPreviews: function() {
            chrome.storage.local.get(null, function(items) {
                items.gsPreviews = {};
                chrome.storage.local.set(items);
            });
        },


        fetchOldGsHistory: function() {

            var result = localStorage.getItem(this.HISTORY_OLD);
            if (result !== null) {
                result = JSON.parse(result);
            }
            return result;
        },

        removeOldGsHistory: function() {
            localStorage.removeItem(this.HISTORY_OLD);
        },

        fetchGsHistory: function() {

            var result = localStorage.getItem(this.HISTORY);
            if (result === null) {
                result = [];
            } else {
                result = JSON.parse(result);
            }
            return result;
        },

        setGsHistory: function(gsHistory) {
            localStorage.setItem(this.HISTORY, JSON.stringify(gsHistory));
        },

        clearGsHistory: function(gsHistory) {
            this.setGsHistory([]);
        },

        fetchTabFromHistory: function(tabUrl) {

            var gsHistory = this.fetchGsHistory(),
                i;

            for (i = 0; i < gsHistory.length; i++) {
                if (gsHistory[i].url === tabUrl) {
                    return gsHistory[i];
                }
            }
            return false;
        },/*

        saveTabToHistory: function(tabUrl, tabProperties) {

            var gsHistory = this.fetchGsHistory(),
                i;

            for (i = 0; i < gsHistory.length; i++) {
                if (gsHistory[i].url === tabUrl) {
                    gsHistory[i] = tabProperties;
                    break;
                }
            }
            localStorage.setItem(this.HISTORY, JSON.stringify(gsHistory));
        },*/

        removeTabFromHistory: function(tabUrl) {

            var gsHistory = this.fetchGsHistory(),
                i;

            for (i = 0; i < gsHistory.length; i++) {
                if (gsHistory[i].url === tabUrl) {
                    gsHistory.splice(i, 1);
                    break;
                }
            }
            localStorage.setItem(this.HISTORY, JSON.stringify(gsHistory));
        },

        removeTabFromSessionHistory: function(sessionId, windowId, tabId) {

            var gsSessionHistory = this.fetchGsSessionHistory(),
                i,
                j,
                k;

            for (i = 0; i < gsSessionHistory.length; i++) {
                if (gsSessionHistory[i].id == sessionId) {

                    for (j = 0; j < gsSessionHistory[i].windows.length; j++) {
                        if (gsSessionHistory[i].windows[j].id == windowId) {

                            for (k = 0; k < gsSessionHistory[i].windows[j].tabs.length; k++) {
                                if (gsSessionHistory[i].windows[j].tabs[k].id == tabId ||
                                        gsSessionHistory[i].windows[j].tabs[k].url == tabId) {
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

        fetchGsSessionHistory: function() {

            var result = localStorage.getItem(this.SESSION_HISTORY),
                sessionHistory;

            //if there is no history, try migrating history for gsHistory
            if (result === null) {

                var gsHistory = this.fetchGsHistory(),
                    i,
                    curSession,
                    curWindow,
                    curTab,
                    groupKey,
                    tabProperties;

                sessionHistory = [];

                gsHistory.sort(this.compareDate);

                for (i = 0; i < gsHistory.length; i++) {
                    tabProperties = gsHistory[i];
                    groupKey = this.getFormattedDate(tabProperties.date, false);

                    curSession = this.getSessionFromGroupKey(groupKey, sessionHistory);
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
                }
                this.setGsSessionHistory(sessionHistory);

            } else {
                sessionHistory = JSON.parse(result);
            }
            return sessionHistory;
        },

        setGsSessionHistory: function(sessionHistory) {
            localStorage.setItem(this.SESSION_HISTORY, JSON.stringify(sessionHistory));
        },

        clearGsSessionHistory: function(gsHistory) {
            this.setGsSessionHistory([]);
        },

        getSessionFromGroupKey: function(groupKey, sessionHistory) {
            var i = 0;
            for (i = 0; i < sessionHistory.length; i++) {
                if (sessionHistory[i].id == groupKey) {
                    return sessionHistory[i];
                }
            }
            return false;
        },
        getWindowFromSession: function(windowId, session) {
            var i = 0;
            for (i = 0; i < session.windows.length; i++) {
                if (session.windows[i].id == windowId) {
                    return session.windows[i];
                }
            }
            return false;
        },
        getTabFromWindow: function(id, window) {
            var i = 0;
            for (i = 0; i < window.tabs.length; i++) {
                if (window.tabs[i].id == id) {
                    return window.tabs[i];

                } else if (window.tabs[i].url == id) {
                    return window.tabs[i];
                }
            }
            return false;
        },

        saveWindowsToSessionHistory: function(sessionId, windowsArray) {

            var gsSessionHistory = this.fetchGsSessionHistory(),
                i,
                match = false;

            for (i = 0; i < gsSessionHistory.length; i++) {
                if (gsSessionHistory[i].id === sessionId) {
                    gsSessionHistory[i].windows = windowsArray;
                    gsSessionHistory[i].date = new Date();
                    match = true;
                    break;
                }
            }

            //if no matching window id found. create a new entry
            if (!match) {
                gsSessionHistory.unshift({id: sessionId, windows: windowsArray, date: new Date()});
            }

            //trim stored windows down to last x sessions
            while (gsSessionHistory.length > this.getOption(this.MAX_HISTORIES)) {
                gsSessionHistory.splice(gsSessionHistory.length - 1, 1);
            }

            this.setGsSessionHistory(gsSessionHistory);
        },

        generateSuspendedUrl: function(tabUrl, tabTitle) {
            var args = '#url=' + encodeURIComponent(tabUrl);
            return chrome.extension.getURL('suspended.html' + args);
        },

        getHashVariable: function(key, hash) {

            var parts,
                temp,
                i;

            if (hash.length === 0) {
                return false;
            }

            parts = hash.substring(1).split('&');
            for (i = 0; i < parts.length; i++) {
                temp = parts[i].split('=');
                if (temp[0] === key) {
                    return decodeURIComponent(temp[1]);
                }
            }
            return false;
        },

        getFormattedDate: function(date, includeTime) {
            var d = new Date(date),
                cur_date = ('0' + d.getDate()).slice(-2),
                cur_month = ('0' + (d.getMonth() + 1)).slice(-2),
                cur_year = d.getFullYear(),
                cur_time = d.toTimeString().match(/^([0-9]{2}:[0-9]{2})/)[0];

            if (includeTime) {
                return cur_date + '-' + cur_month + '-' + cur_year + ': ' + cur_time;
            } else {
                return cur_date + '-' + cur_month + ' ' + cur_year;
            }
        },

        getHumanDate: function(date) {
            var m_names = new Array('January', 'February', 'March',
                'April', 'May', 'June', 'July', 'August', 'September',
                'October', 'November', 'December');

            var d = new Date(date);
            var curr_date = d.getDate();
            var sup = '';
            if (curr_date == 1 || curr_date == 21 || curr_date ==31) sup = 'st';
            else if (curr_date == 2 || curr_date == 22) sup = 'nd';
            else if (curr_date == 3 || curr_date == 23) sup = 'rd';
            else sup = 'th';

            var curr_month = d.getMonth();
            var curr_year = d.getFullYear();

            return curr_date + sup + ' ' + m_names[curr_month] + ' ' + curr_year;
        },

        compareDate: function(a, b) {
            if (a.date < b.date) {
                return -1;
            }
            if (a.date > b.date) {
                return 1;
            }
            return 0;
        },

        getRootUrl: function(url) {
            var rootUrlStr = url,
                rootUrlStr = rootUrlStr.indexOf('//') > 0 ? rootUrlStr.substring(rootUrlStr.indexOf('//') + 2) : rootUrlStr;
                rootUrlStr = rootUrlStr.substring(0, rootUrlStr.indexOf('/'));
            return rootUrlStr;
        }
    };

    gsUtils.initSettings();
    window.gsUtils = gsUtils;

}(window));
