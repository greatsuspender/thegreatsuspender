/*global window, document, chrome, console, localStorage */

(function(window) {

    'use strict';

    var gsStorage = {

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

        fetchFavicon: function(tabUrl, callback) {
            chrome.storage.local.get(null, function(items) {
                if (typeof (items.gsFavicons) === 'undefined') {
                    items.gsFavicons = {};
                    chrome.storage.local.set(items);
                    callback(null);

                } else if (typeof (items.gsFavicons[tabUrl]) === 'undefined') {
                    callback(null);

                } else {
                    callback(items.gsFavicons[tabUrl]);
                }
            });
        },

        setFavicon: function(tabUrl, favUrl) {
            chrome.storage.local.get(null, function(items) {

                if (typeof (items.gsFavicons) === 'undefined') {
                    items.gsFavicons = {};
                }
                items.gsFavicons[tabUrl] = favUrl;
                chrome.storage.local.set(items);
            });
        },

        clearPreviews: function() {
            chrome.storage.local.get(null, function(items) {
                items.gsPreviews = {};
                chrome.storage.local.set(items);
            });
        },

        fetchPreviewOption: function() {
            return localStorage.getItem('preview') ? localStorage.getItem('preview') === 'true' : false;
        },

        setPreviewOption: function(preview) {
            localStorage.setItem('preview', preview);
        },

        fetchPreviewQualityOption: function() {
            return localStorage.getItem('previewQuality') ? localStorage.getItem('previewQuality') === 'true' : false;
        },

        setPreviewQualityOption: function(previewQuality) {
            localStorage.setItem('previewQuality', previewQuality);
        },

        fetchOnlineCheckOption: function() {
            return localStorage.getItem('onlineCheck') ? localStorage.getItem('onlineCheck') === 'true' : false;
        },

        setOnlineCheckOption: function(check) {
            localStorage.setItem('onlineCheck', check);
        },

        fetchTimeToSuspendOption: function() {
            return localStorage.getItem('gsTimeToSuspend') || 0;
        },

        setTimeToSuspendOption: function(timeToSuspend) {
            localStorage.setItem('gsTimeToSuspend', timeToSuspend);
        },

        fetchMaxHistoriesOption: function() {
            return localStorage.getItem('gsMaxHistories') || 4;
        },

        setMaxHistoriesOption: function(maxHistories) {
            localStorage.setItem('gsMaxHistories', maxHistories);
        },

        fetchUnsuspendOnFocusOption: function() {
            return localStorage.getItem('gsUnsuspendOnFocus') ? localStorage.getItem('gsUnsuspendOnFocus') === 'true' : false;
        },

        setUnsuspendOnFocusOption: function(unsuspendOnFocus) {
            localStorage.setItem('gsUnsuspendOnFocus', unsuspendOnFocus);
        },

        fetchDontSuspendPinnedOption: function() {
            return localStorage.getItem('gsDontSuspendPinned') ? localStorage.getItem('gsDontSuspendPinned') === 'true' : false;
        },

        setDontSuspendPinnedOption: function(dontSuspendPinned) {
            localStorage.setItem('gsDontSuspendPinned', dontSuspendPinned);
        },

        fetchDontSuspendFormsOption: function() {
            return localStorage.getItem('gsDontSuspendForms') ? localStorage.getItem('gsDontSuspendForms') === 'true' : false;
        },

        setDontSuspendFormsOption: function(dontSuspendForms) {
            localStorage.setItem('gsDontSuspendForms', dontSuspendForms);
        },

        fetchIgnoreCacheOption: function() {
            return localStorage.getItem('gsIgnoreCache') ? localStorage.getItem('gsIgnoreCache') === 'true' : false;
        },

        setIgnoreCacheOption: function(ignoreCache) {
            localStorage.setItem('gsIgnoreCache', ignoreCache);
        },

        fetchVersion: function() {
            return localStorage.getItem('gsVersion');
        },

        setVersion: function(newVersion) {
            localStorage.setItem('gsVersion', newVersion);
        },

        fetchWhitelist: function() {
            return localStorage.getItem('gsWhitelist') || '';
        },
        fetchSynchedWhitelist: function(callback) {
            var self = this;
            chrome.storage.sync.get('gsWhitelist', function(items) {
                if (items) {
                    localStorage.setItem('gsWhitelist', items.gsWhitelist);
                    callback(items.gsWhitelist);
                } else {
                    callback(self.fetchWhitelist());
                }
            });
        },

        setWhitelist: function(whitelist) {

            chrome.storage.sync.set({'gsWhitelist': whitelist}, function() {
                console.log('Saved whitelist in the cloud');
            });
            localStorage.setItem('gsWhitelist', whitelist);
        },

        saveToWhitelist: function(newString) {
            var whitelist = localStorage.getItem('gsWhitelist') || '';
            this.setWhitelist(whitelist + ' ' + newString);
        },

        fetchOldGsHistory: function() {

            var result = localStorage.getItem('gsHistory');
            if (result !== null) {
                result = JSON.parse(result);
            }
            return result;
        },

        removeOldGsHistory: function() {
            localStorage.removeItem('gsHistory');
        },

        fetchGsHistory: function() {

            var result = localStorage.getItem('gsHistory2');
            if (result === null) {
                result = [];
            } else {
                result = JSON.parse(result);
            }
            return result;
        },

        setGsHistory: function(gsHistory) {
            localStorage.setItem('gsHistory2', JSON.stringify(gsHistory));
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
        },

        saveTabToHistory: function(tabUrl, tabProperties) {

            var gsHistory = this.fetchGsHistory(),
                i;

            for (i = 0; i < gsHistory.length; i++) {
                if (gsHistory[i].url === tabUrl) {
                    gsHistory[i] = tabProperties;
                    break;
                }
            }
            localStorage.setItem('gsHistory2', JSON.stringify(gsHistory));
        },

        removeTabFromHistory: function(tabUrl) {

            var gsHistory = this.fetchGsHistory(),
                i;

            for (i = 0; i < gsHistory.length; i++) {
                if (gsHistory[i].url === tabUrl) {
                    gsHistory.splice(i, 1);
                    break;
                }
            }
            localStorage.setItem('gsHistory2', JSON.stringify(gsHistory));
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

            var result = localStorage.getItem('gsSessionHistory'),
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
            localStorage.setItem('gsSessionHistory', JSON.stringify(sessionHistory));
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
            while (gsSessionHistory.length > this.fetchMaxHistoriesOption()) {
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
    window.gsStorage = gsStorage;

}(window));
