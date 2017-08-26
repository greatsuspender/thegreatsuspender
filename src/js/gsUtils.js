/*global chrome, localStorage, db, tgs */
'use strict';

var gsUtils = {

    SCREEN_CAPTURE: 'screenCapture',
    SCREEN_CAPTURE_FORCE: 'screenCaptureForce',
    ONLINE_CHECK: 'onlineCheck',
    BATTERY_CHECK: 'batteryCheck',
    UNSUSPEND_ON_FOCUS: 'gsUnsuspendOnFocus',
    SUSPEND_TIME: 'gsTimeToSuspend',
    IGNORE_PINNED: 'gsDontSuspendPinned',
    IGNORE_FORMS: 'gsDontSuspendForms',
    IGNORE_AUDIO: 'gsDontSuspendAudio',
    IGNORE_CACHE: 'gsIgnoreCache',
    ADD_CONTEXT: 'gsAddContextMenu',
    SYNC_SETTINGS: 'gsSyncSettings',
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

    noop: function () {},

    getSettingsDefaults: function () {

        var defaults = {};
        defaults[this.SCREEN_CAPTURE] = '0';
        defaults[this.SCREEN_CAPTURE_FORCE] = false;
        defaults[this.ONLINE_CHECK] = false;
        defaults[this.BATTERY_CHECK] = false;
        defaults[this.UNSUSPEND_ON_FOCUS] = false;
        defaults[this.IGNORE_PINNED] = true;
        defaults[this.IGNORE_FORMS] = true;
        defaults[this.IGNORE_AUDIO] = true;
        defaults[this.IGNORE_CACHE] = false;
        defaults[this.ADD_CONTEXT] = true;
        defaults[this.SYNC_SETTINGS] = true;
        defaults[this.SUSPEND_TIME] = '60';
        defaults[this.NO_NAG] = false;
        defaults[this.WHITELIST] = '';
        defaults[this.THEME] = 'light';

        return defaults;
    },

    /**
    * LOCAL STORAGE FUNCTIONS
    */

    //populate localstorage settings with sync settings where undefined
    initSettings: function () {
        var self = this;
        var rawLocalSettings = JSON.parse(localStorage.getItem('gsSettings')) || {};
        var defaultSettings = gsUtils.getSettingsDefaults();
        var shouldSyncSettings = rawLocalSettings.hasOwnProperty(self.SYNC_SETTINGS)
            ? rawLocalSettings[self.SYNC_SETTINGS] : defaultSettings[self.SYNC_SETTINGS];
        var allSettingKeys = Object.keys(defaultSettings);
        chrome.storage.sync.get(allSettingKeys, function (syncedSettings) {

            // if synced setting exists and local setting does not exist or syncing is turned on
            // then overwrite with synced value
            var newSettings = {};
            allSettingKeys.forEach(function (key) {
                if (key !== self.SYNC_SETTINGS && syncedSettings.hasOwnProperty(key) &&
                    (!rawLocalSettings.hasOwnProperty(key) || shouldSyncSettings)) {
                    newSettings[key] = syncedSettings[key];
                }
                //make sure we have a value for this key
                if (!newSettings.hasOwnProperty(key)) {
                    newSettings[key] = rawLocalSettings.hasOwnProperty(key) ? rawLocalSettings[key] : defaultSettings[key];
                }
            });
            self.saveSettings(newSettings);

            // if any of the new settings are different to those in sync, then trigger a resync
            var triggerResync = false;
            allSettingKeys.forEach(function (key) {
                if (key !== self.SYNC_SETTINGS && syncedSettings[key] !== newSettings[key]) {
                    triggerResync = true;
                }
            });
            if (triggerResync) {
                self.syncSettings(newSettings);
            }
        });

        // Listen for changes to synced settings
        chrome.storage.onChanged.addListener(function (remoteSettings, namespace) {
            if (namespace !== 'sync' || !remoteSettings) {
                return;
            }
            var shouldSync = self.getOption(self.SYNC_SETTINGS);
            if (shouldSync) {
                var localSettings = self.getSettings();
                var changedSettingKeys = [];
                Object.keys(remoteSettings).forEach(function (key) {
                    var remoteSetting = remoteSettings[key];
                    if (localSettings[key] !== remoteSetting.newValue) {
                        console.log('Changed value from sync', key, remoteSetting.newValue);
                        changedSettingKeys.push(key);
                        localSettings[key] = remoteSetting.newValue;
                    }
                });

                if (changedSettingKeys.length > 0) {
                    self.saveSettings(localSettings);
                    self.performPostSaveUpdates(changedSettingKeys);
                }
            }
        });
    },

    //due to migration issues and new settings being added, i have built in some redundancy
    //here so that getOption will always return a valid value.
    getOption: function (prop) {
        var settings = this.getSettings(),
            defaults;

        //test that option exists in settings object
        if (typeof settings[prop] === 'undefined' || settings[prop] === null) {
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
        // console.log('setting prop: ' + prop + ' to value ' + value);
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

    // Push settings to sync
    syncSettings: function () {
        var settings = this.getSettings();
        if (settings[this.SYNC_SETTINGS]) {
            // Since sync is a local setting, delete it to simplify things.
            delete settings[this.SYNC_SETTINGS];
            // console.log('Pushing local settings to sync', settings);
            chrome.storage.sync.set(settings, this.noop);
        }
    },

    performPostSaveUpdates: function (changedSettingKeys) {

        //if interval, or form input preferences have changed then reset the content scripts
        var preferencesToUpdate = [];
        if (this.contains(changedSettingKeys, gsUtils.SUSPEND_TIME)) {
            preferencesToUpdate.push(gsUtils.SUSPEND_TIME);
        }
        if (this.contains(changedSettingKeys, gsUtils.IGNORE_FORMS)) {
            preferencesToUpdate.push(gsUtils.IGNORE_FORMS);
        }
        if (preferencesToUpdate.length > 0) {
            tgs.resetContentScripts(preferencesToUpdate);
        }

        //if context menu has been disabled then remove from chrome
        if (this.contains(changedSettingKeys, gsUtils.ADD_CONTEXT)) {
            var addContextMenu = gsUtils.getOption(gsUtils.ADD_CONTEXT);
            tgs.buildContextMenu(addContextMenu);
        }

        //if theme or preview settings have changed then refresh all suspended pages
        if (this.contains(changedSettingKeys, gsUtils.THEME) ||
          this.contains(changedSettingKeys, gsUtils.SCREEN_CAPTURE)) {
            tgs.resuspendAllSuspendedTabs();
        }
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
        var whitelistString = whitelistItems.join('\n');
        this.setOption(this.WHITELIST, whitelistString);
        this.syncSettings({ [this.WHITELIST]: whitelistString });
        this.updateOptionsView();
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
                new RegExp(whitelistItem); // eslint-disable-line no-new
            } catch (e) {
                return false;
            }
            return new RegExp(whitelistItem).test(word);

        // test as substring
        } else {
            return word.indexOf(whitelistItem) >= 0;
        }
    },

    saveToWhitelist: function (newString) {
        var whitelist = this.getOption(this.WHITELIST);
        whitelist = whitelist ? whitelist + '\n' + newString : newString;
        whitelist = this.cleanupWhitelist(whitelist);
        this.setOption(this.WHITELIST, whitelist);
        this.syncSettings({ [this.WHITELIST]: whitelist });
        this.updateOptionsView();
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

    updateOptionsView: function () {
        chrome.tabs.query({ url: chrome.extension.getURL('options.html') }, function (tabs) {
            for (var i = 0; i < tabs.length; i++) {
                chrome.tabs.sendMessage(tabs[i].id, { action: 'reloadOptions' });
            }
        });
    },

    fetchLastVersion: function () {
        var version = localStorage.getItem(this.APP_VERSION);
        if (version !== null) {
            version = JSON.parse(version);
            return version + '';
        } else {
            return '0.0.0';
        }
    },

    setLastVersion: function (newVersion) {
        localStorage.setItem(this.APP_VERSION, JSON.stringify(newVersion));
    },

    fetchNoticeVersion: function () {
        var result = localStorage.getItem(this.LAST_NOTICE);
        if (result !== null) {
            result = JSON.parse(result);
            return result + '';
        } else {
            return '0.0.0';
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
            return s.query(self.DB_PREVIEWS, 'url')
                .only(tabUrl)
                .execute();

        }).then(function (results) {
            if (results.length > 0) {
                callback(results[0]);
            } else {
                callback(null);
            }
        });
    },

    addPreviewImage: function (tabUrl, previewUrl, callback) {
        var self = this,
            server;
        this.getDb().then(function (s) {
            server = s;
            return server.query(self.DB_PREVIEWS, 'url')
                .only(tabUrl)
                .execute();

        }).then(function (results) {
            if (results.length > 0) {
                return server.remove(self.DB_PREVIEWS, results[0].id);
            } else {
                return Promise.resolve();
            }
        }).then(function () {
            server.add(self.DB_PREVIEWS, {url: tabUrl, img: previewUrl});
            if (typeof callback === 'function') callback();
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

        }).then(function (results) {
            if (results.length > 0) {
                return server.remove(self.DB_SUSPENDED_TABINFO, results[0].id);
            } else {
                return Promise.resolve();
            }
        }).then(function () {
            server.add(self.DB_SUSPENDED_TABINFO, tabProperties).then(function () {
                if (typeof callback === 'function') callback();
            });
        });
    },

    fetchTabInfo: function (tabUrl) {
        var self = this;
        return this.getDb().then(function (s) {
            return s.query(self.DB_SUSPENDED_TABINFO, 'url')
                .only(tabUrl)
                .distinct()
                .desc()
                .execute()
                .then(function (results) {
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

        }).then(function (result) {
            if (result.length > 0) {
                result = result[0];
                session.id = result.id; //copy across id from matching session
                session.date = (new Date()).toISOString();
                return server.update(tableName, session); //then update based on that id
            } else {
                return server.add(tableName, session);
            }
        }).then(function (result) {
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
            return s.query(tableName, 'sessionId')
                .only(sessionId)
                .distinct()
                .desc()
                .execute()
                .then(function (results) {
                    return results.length > 0 ? results[0] : null;
                });
        });
    },

    fetchLastSession: function () {
        var self = this,
            currentSessionId,
            lastSession = null;

        currentSessionId = typeof chrome.extension.getBackgroundPage !== 'undefined'
            ? tgs.sessionId
            : '';

        return this.getDb().then(function (s) {
            return s.query(self.DB_CURRENT_SESSIONS, 'id')
                .all()
                .desc()
                .execute()
                .then(function (results) {

                    if (results.length > 0) {
                        results.some(function (curSession) {

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

    removeTabFromSessionHistory: function (sessionId, windowId, tabId, callback) {

        var self = this,
            matched;

        callback = typeof callback !== 'function' ? this.noop : callback;

        this.fetchSessionById(sessionId).then(function (gsSession) {

            gsSession.windows.some(function (curWindow, windowIndex) {
                matched = curWindow.tabs.some(function (curTab, tabIndex) {
                    //leave this as a loose matching as sometimes it is comparing strings. other times ints
                    if (curTab.id == tabId || curTab.url == tabId) { // eslint-disable-line eqeqeq
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
                self.updateSession(gsSession, function (session) {
                    callback(session);
                });

            //or remove session if it no longer contains any windows
            } else {
                self.removeSessionFromHistory(sessionId, function (session) {
                    callback();
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

        }).then(function (result) {
            if (result.length > 0) {
                session = result[0];
                server.remove(tableName, session.id);
            }
        }).then(callback);
    },

    trimDbItems: function () {
        var self = this,
            server,
            maxTabItems = 1000,
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

            //if there are more than maxTabItems items, then remove the oldest ones
            if (results.length > maxTabItems) {
                itemsToRemove = results.length - maxTabItems;
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

    documentReadyAsPromsied: function (doc) {
        return new Promise(function (resolve, reject) {
            if (doc.readyState !== 'loading') {
                resolve();
            } else {
                doc.addEventListener('DOMContentLoaded', function () {
                    resolve();
                });
            }
        });
    },

    localiseHtml: function (parentEl) {
        var replaceFunc = function (match, p1) {
            return p1 ? chrome.i18n.getMessage(p1) : '';
        };
        Array.prototype.forEach.call(parentEl.getElementsByTagName('*'), function (el) {
            if (el.hasAttribute('data-i18n')) {
                el.innerHTML = el.getAttribute('data-i18n').replace(/__MSG_(\w+)__/g, replaceFunc);
            }
            if (el.hasAttribute('data-i18n-tooltip')) {
                el.setAttribute('data-i18n-tooltip', el.getAttribute('data-i18n-tooltip').replace(/__MSG_(\w+)__/g, replaceFunc));
            }
        });
    },

    documentReadyAndLocalisedAsPromsied: function (doc) {
        var self = this;
        return self.documentReadyAsPromsied(doc).then(function () {
            return self.localiseHtml(doc);
        });
    },

    //turn this into a string to make comparisons easier further down the track
    generateSessionId: function () {
        return Math.floor(Math.random() * 1000000) + '';
    },

    generateSuspendedUrl: function (url, title, scrollPos) {
        var args = '#' +
            'ttl=' + encodeURIComponent(title) + '&' +
            'pos=' + (scrollPos || '0') + '&' +
            'uri=' + (url);

        return chrome.extension.getURL('suspended.html' + args);
    },

    getHashVariable: function (key, urlStr) {

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
    getSuspendedTitle: function (urlStr) {
        return decodeURIComponent(this.getHashVariable('ttl', urlStr) || '');
    },
    getSuspendedScrollPosition: function (urlStr) {
        return decodeURIComponent(this.getHashVariable('pos', urlStr) || '');
    },
    getSuspendedUrl: function (urlStr) {
        return this.getHashVariable('uri', urlStr) || decodeURIComponent(this.getHashVariable('url', urlStr) || '');
    },

    getSuspendedTabCount: function () {
        var suspendedTabCount = 0;
        chrome.extension.getViews({type: 'tab'}).forEach(function (window) {
            if (window.location.href.indexOf('suspended.html') > 0) {
                suspendedTabCount++;
            }
        });
        return suspendedTabCount;
    },
    isExtensionTabOpen: function (tabName) {
        var tabFound = chrome.extension.getViews({type: 'tab'}).some(function (window) {
            return (window.location.href.indexOf(tabName + '.html') > 0);
        });
        return tabFound;
    },

    contains: function (array, value) {
        for (var i = 0; i < array.length; i++) {
            if (array[i] === value) return true;
        }
        return false;
    },

    htmlEncode: function (text) {
        return document.createElement('pre').appendChild(document.createTextNode(text)).parentNode.innerHTML;
    },

    getSimpleDate: function (date) {
        var d = new Date(date);
        return ('0' + d.getDate()).slice(-2) + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
            d.getFullYear() + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    },

    getHumanDate: function (date) {
        var monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
            d = new Date(date),
            currentDate = d.getDate(),
            currentMonth = d.getMonth(),
            currentYear = d.getFullYear(),
            currentHours = d.getHours(),
            currentMinutes = d.getMinutes();

        // var suffix;
        // if (currentDate === 1 || currentDate === 21 || currentDate === 31) {
        //     suffix = 'st';
        // } else if (currentDate === 2 || currentDate === 22) {
        //     suffix = 'nd';
        // } else if (currentDate === 3 || currentDate === 23) {
        //     suffix = 'rd';
        // } else {
        //     suffix = 'th';
        // }

        var ampm = currentHours >= 12 ? 'pm' : 'am';
        var hoursString = (currentHours % 12) || 12;
        var minutesString = ('0' + currentMinutes).slice(-2);

        return currentDate + ' ' + monthNames[currentMonth] + ' ' + currentYear + ' ' + hoursString + ':' + minutesString + ampm;
    },

    getChromeVersion: function () {
        var raw = navigator.userAgent.match(/Chrom(e|ium)\/([0-9]+)\./);
        return raw ? parseInt(raw[2], 10) : false;
    },

    generateHashCode: function (text) {
        var hash = 0, i, chr, len;
        if (!text) return hash;
        for (i = 0, len = text.length; i < len; i++) {
            chr = text.charCodeAt(i);
            hash = ((hash << 5) - hash) + chr;
            hash |= 0; // Convert to 32bit integer
        }
        return Math.abs(hash);
    },

    getRootUrl: function (url, includePath) {
        var rootUrlStr;

        url = url || '';
        if (url.indexOf('suspended.html') > 0) {
            url = gsUtils.getSuspendedUrl(url);
        }

        // remove scheme
        rootUrlStr = url;
        if (rootUrlStr.indexOf('//') > 0) {
            rootUrlStr = rootUrlStr.substring(rootUrlStr.indexOf('//') + 2);
        } else {
            rootUrlStr = url;
        }

        // remove path
        if (!includePath) {
            rootUrlStr = rootUrlStr.substring(0, rootUrlStr.indexOf('/'));

        } else {
            // remove query string
            var match = rootUrlStr.match(/\/?[?#]+/);
            if (match) {
                rootUrlStr = rootUrlStr.substring(0, match.index);
            }
            // remove trailing slash
            match = rootUrlStr.match(/\/$/);
            if (match) {
                rootUrlStr = rootUrlStr.substring(0, match.index);
            }
        }

        return rootUrlStr;
    },

    recoverLostTabs: function (callback) {

        var self = this;

        callback = typeof callback !== 'function' ? this.noop : callback;

        this.fetchLastSession().then(function (lastSession) {
            if (!lastSession) {
                callback(null);
            }
            chrome.windows.getAll({ populate: true }, function (currentWindows) {

                var matchedCurrentWindowBySessionWindowId = self.matchCurrentWindowsWithLastSessionWindows(lastSession.windows, currentWindows);

                //attempt to automatically restore any lost tabs/windows in their proper positions
                lastSession.windows.forEach(function (sessionWindow) {
                    if (!matchedCurrentWindowBySessionWindowId[sessionWindow.id]) {
                        console.log('Could not find match for sessionWindow: ', sessionWindow);
                        self.recoverWindow(sessionWindow);
                    } else {
                        self.recoverWindow(sessionWindow, matchedCurrentWindowBySessionWindowId[sessionWindow.id]);
                    }
                });

                callback();
            });
        });
    },

    //try to match session windows with currently open windows
    matchCurrentWindowsWithLastSessionWindows: function (unmatchedSessionWindows, unmatchedCurrentWindows) {

        var self = this;
        var matchedCurrentWindowBySessionWindowId = {};

        //if there is a current window open that matches the id of the session window id then match it
        unmatchedSessionWindows.slice().forEach(function (sessionWindow) {
            var matchingCurrentWindow = unmatchedCurrentWindows.find(function (window) { return window.id === sessionWindow.id; });
            if (matchingCurrentWindow) {
                matchedCurrentWindowBySessionWindowId[sessionWindow.id] = matchingCurrentWindow;
                //remove from unmatchedSessionWindows and unmatchedCurrentWindows
                unmatchedSessionWindows = unmatchedSessionWindows.filter(function (window) { return window.id !== sessionWindow.id; });
                unmatchedCurrentWindows = unmatchedCurrentWindows.filter(function (window) { return window.id !== matchingCurrentWindow.id; });
                console.log('Matched with ids: ', sessionWindow, matchingCurrentWindow);
            }
        });

        if (unmatchedSessionWindows.length === 0 || unmatchedCurrentWindows.length === 0) {
            return matchedCurrentWindowBySessionWindowId;
        }

        //if we still have session windows that haven't been matched to a current window then attempt matching based on tab urls
        var tabMatchingObjects = self.generateTabMatchingObjects(unmatchedSessionWindows, unmatchedCurrentWindows);

        //find the tab matching objects with the highest tabMatchCounts
        while (unmatchedSessionWindows.length > 0 && unmatchedCurrentWindows.length > 0) {
            var maxTabMatchCount = Math.max(...tabMatchingObjects.map(function (o) { return o.tabMatchCount; }));
            var bestTabMatchingObject = tabMatchingObjects.find(function (o) { return o.tabMatchCount === maxTabMatchCount; });

            matchedCurrentWindowBySessionWindowId[bestTabMatchingObject.sessionWindow.id] = bestTabMatchingObject.currentWindow;

            //remove from unmatchedSessionWindows and unmatchedCurrentWindows
            var unmatchedSessionWindowsLengthBefore = unmatchedSessionWindows.length;
            unmatchedSessionWindows = unmatchedSessionWindows.filter(function (window) { return window.id !== bestTabMatchingObject.sessionWindow.id; });
            unmatchedCurrentWindows = unmatchedCurrentWindows.filter(function (window) { return window.id !== bestTabMatchingObject.currentWindow.id; });
            console.log('Matched with tab count of ' + maxTabMatchCount + ': ', bestTabMatchingObject.sessionWindow, bestTabMatchingObject.currentWindow);

            //remove from tabMatchingObjects
            tabMatchingObjects = tabMatchingObjects.filter(function (o) { return o.sessionWindow !== bestTabMatchingObject.sessionWindow & o.currentWindow !== bestTabMatchingObject.currentWindow; });

            //safety check to make sure we dont get stuck in infinite loop. should never happen though.
            if (unmatchedSessionWindows.length >= unmatchedSessionWindowsLengthBefore) {
                break;
            }
        }

        return matchedCurrentWindowBySessionWindowId;
    },

    generateTabMatchingObjects: function (sessionWindows, currentWindows) {

        var unsuspendedSessionUrlsByWindowId = {};
        sessionWindows.forEach(function (sessionWindow) {
            unsuspendedSessionUrlsByWindowId[sessionWindow.id] = [];
            sessionWindow.tabs.forEach(function (curTab) {
                if (!tgs.isSpecialTab(curTab) && !tgs.isSuspended(curTab)) {
                    unsuspendedSessionUrlsByWindowId[sessionWindow.id].push(curTab.url);
                }
            });
        });
        var unsuspendedCurrentUrlsByWindowId = {};
        currentWindows.forEach(function (currentWindow) {
            unsuspendedCurrentUrlsByWindowId[currentWindow.id] = [];
            currentWindow.tabs.forEach(function (curTab) {
                if (!tgs.isSpecialTab(curTab) && !tgs.isSuspended(curTab)) {
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
    },

    recoverWindow: function (sessionWindow, currentWindow) {

        var currentTabIds = [],
            currentTabUrls = [];

        //if we have been provided with a current window to recover into
        if (currentWindow) {
            currentWindow.tabs.forEach(function (currentTab) {
                currentTabIds.push(currentTab.id);
                currentTabUrls.push(currentTab.url);
            });

            sessionWindow.tabs.forEach(function (sessionTab) {

                //if current tab does not exist then recreate it
                if (!tgs.isSpecialTab(sessionTab) &&
                        !currentTabUrls.includes(sessionTab.url) && !currentTabIds.includes(sessionTab.id)) {
                    chrome.tabs.create({
                        windowId: currentWindow.id,
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
            if (curWindow.id == windowId) { // eslint-disable-line eqeqeq
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
            date: (new Date()).toISOString()
        };
        this.updateSession(session);
    },

    /**
    * MIGRATIONS
    */

    performMigration: function (oldVersion) {

        var self = this,
            server;

        var major = parseInt(oldVersion.split('.')[0] || 0),
            minor = parseInt(oldVersion.split('.')[1] || 0),
            patch = parseInt(oldVersion.split('.')[2] || 0);

        //perform migrated history fixup
        if (major < 6 || (major === 6 && minor < 13)) { // if (oldVersion < 6.13)

            //fix up migrated saved session and newly saved session sessionIds
            this.getDb().then(function (s) {
                server = s;
                return s.query(self.DB_SAVED_SESSIONS).all().execute();

            }).then(function (savedSessions) {
                savedSessions.forEach(function (session, index) {
                    if (session.id === 7777) {
                        session.sessionId = '_7777';
                        session.name = 'Recovered tabs';
                        session.date = (new Date(session.date)).toISOString();
                    } else {
                        session.sessionId = '_' + self.generateHashCode(session.name);
                    }
                    server.update(self.DB_SAVED_SESSIONS, session);
                });
            });
        }
        if (major < 6 || (major === 6 && minor < 30)) { // if (oldVersion < 6.30)

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
        if (major < 6 || (major === 6 && minor < 31)) { // if (oldVersion < 6.31)
            // When migrating old settings, disable sync by default.
            // For new installs, we want this to default to on.
            this.setOption(this.SYNC_SETTINGS, false);

            chrome.cookies.getAll({}, function (cookies) {
                var scrollPosByTabId = {};
                cookies.forEach(function (cookie) {
                    if (cookie.name.indexOf('gsScrollPos') === 0) {
                        if (cookie.value && cookie.value !== '0') {
                            var tabId = cookie.name.substr(12);
                            scrollPosByTabId[tabId] = cookie.value;
                        }
                        var prefix = cookie.secure ? 'https://' : 'http://';
                        if (cookie.domain.charAt(0) === '.') {
                            prefix += 'www';
                        }
                        var url = prefix + cookie.domain + cookie.path;
                        chrome.cookies.remove({ 'url': url, 'name': cookie.name });
                    }
                });
                tgs.scrollPosByTabId = scrollPosByTabId;
            });
        }
    }
};
