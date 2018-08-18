/*global chrome, localStorage, db, tgs, gsUtils, gsSession, gsAnalytics */
'use strict';

var gsStorage = {
  SCREEN_CAPTURE: 'screenCapture',
  SCREEN_CAPTURE_FORCE: 'screenCaptureForce',
  SUSPEND_IN_PLACE_OF_DISCARD: 'suspendInPlaceOfDiscard',
  UNSUSPEND_ON_FOCUS: 'gsUnsuspendOnFocus',
  SUSPEND_TIME: 'gsTimeToSuspend',
  IGNORE_WHEN_OFFLINE: 'onlineCheck',
  IGNORE_WHEN_CHARGING: 'batteryCheck',
  IGNORE_PINNED: 'gsDontSuspendPinned',
  IGNORE_FORMS: 'gsDontSuspendForms',
  IGNORE_AUDIO: 'gsDontSuspendAudio',
  IGNORE_ACTIVE_TABS: 'gsDontSuspendActiveTabs',
  IGNORE_CACHE: 'gsIgnoreCache',
  ADD_CONTEXT: 'gsAddContextMenu',
  SYNC_SETTINGS: 'gsSyncSettings',
  NO_NAG: 'gsNoNag',
  THEME: 'gsTheme',
  WHITELIST: 'gsWhitelist',

  DISCARD_AFTER_SUSPEND: 'discardAfterSuspend',
  DISCARD_IN_PLACE_OF_SUSPEND: 'discardInPlaceOfSuspend',

  APP_VERSION: 'gsVersion',
  LAST_NOTICE: 'gsNotice',
  LAST_EXTENSION_RECOVERY: 'gsExtensionRecovery',
  HISTORY_OLD: 'gsHistory',
  HISTORY: 'gsHistory2',
  SESSION_HISTORY: 'gsSessionHistory',

  DB_SERVER: 'tgs',
  DB_VERSION: '2',
  DB_PREVIEWS: 'gsPreviews',
  DB_SUSPENDED_TABINFO: 'gsSuspendedTabInfo',
  DB_CURRENT_SESSIONS: 'gsCurrentSessions',
  DB_SAVED_SESSIONS: 'gsSavedSessions',
  DB_SESSION_PRE_UPGRADE_KEY: 'preUpgradeVersion',
  DB_SESSION_POST_UPGRADE_KEY: 'postUpgradeVersion',

  server: null,
  noop: function() {},

  getSettingsDefaults: function() {
    var defaults = {};
    defaults[this.SCREEN_CAPTURE] = '0';
    defaults[this.SCREEN_CAPTURE_FORCE] = false;
    defaults[this.SUSPEND_IN_PLACE_OF_DISCARD] = true;
    defaults[this.DISCARD_IN_PLACE_OF_SUSPEND] = false;
    defaults[this.DISCARD_AFTER_SUSPEND] = false;
    defaults[this.IGNORE_WHEN_OFFLINE] = false;
    defaults[this.IGNORE_WHEN_CHARGING] = false;
    defaults[this.UNSUSPEND_ON_FOCUS] = false;
    defaults[this.IGNORE_PINNED] = true;
    defaults[this.IGNORE_FORMS] = true;
    defaults[this.IGNORE_AUDIO] = true;
    defaults[this.IGNORE_ACTIVE_TABS] = true;
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
  initSettingsAsPromised: function() {
    var self = this;

    return new Promise(function(resolve) {
      var defaultSettings = gsStorage.getSettingsDefaults();
      var defaultKeys = Object.keys(defaultSettings);
      chrome.storage.sync.get(defaultKeys, function(syncedSettings) {
        gsUtils.log('gsStorage', 'syncedSettings on init: ', syncedSettings);

        var rawLocalSettings;
        try {
          rawLocalSettings = JSON.parse(localStorage.getItem('gsSettings'));
        } catch (e) {
          gsUtils.error(
            'gsStorage',
            'Failed to parse gsSettings: ',
            localStorage.getItem('gsSettings')
          );
        }
        if (!rawLocalSettings) {
          rawLocalSettings = {};
        } else {
          //if we have some rawLocalSettings but SYNC_SETTINGS is not defined
          //then define it as FALSE (as opposed to default of TRUE)
          rawLocalSettings[self.SYNC_SETTINGS] =
            rawLocalSettings[self.SYNC_SETTINGS] || false;
        }
        var shouldSyncSettings = rawLocalSettings[self.SYNC_SETTINGS];

        var mergedSettings = {};
        for (const key of defaultKeys) {
          if (key === self.SYNC_SETTINGS) {
            if (chrome.extension.inIncognitoContext) {
              mergedSettings[key] = false;
            } else {
              mergedSettings[key] = rawLocalSettings.hasOwnProperty(key)
                ? rawLocalSettings[key]
                : defaultSettings[key];
            }
            continue;
          }
          // if synced setting exists and local setting does not exist or
          // syncing is enabled locally then overwrite with synced value
          if (
            syncedSettings.hasOwnProperty(key) &&
            (!rawLocalSettings.hasOwnProperty(key) || shouldSyncSettings)
          ) {
            mergedSettings[key] = syncedSettings[key];
          }
          //fallback on rawLocalSettings
          if (!mergedSettings.hasOwnProperty(key)) {
            mergedSettings[key] = rawLocalSettings[key];
          }
          //fallback on defaultSettings
          if (
            typeof mergedSettings[key] === 'undefined' ||
            mergedSettings[key] === null
          ) {
            gsUtils.error(
              'gsStorage',
              'Missing key: ' + key + '! Will init with default.'
            );
            mergedSettings[key] = defaultSettings[key];
          }
        }
        self.saveSettings(mergedSettings);

        // if any of the new settings are different to those in sync, then trigger a resync
        var triggerResync = false;
        for (const key of defaultKeys) {
          if (
            key !== self.SYNC_SETTINGS &&
            syncedSettings[key] !== mergedSettings[key]
          ) {
            triggerResync = true;
          }
        }
        if (triggerResync) {
          self.syncSettings();
        }

        self.addSettingsSyncListener();
        resolve();
      });
    });
  },

  // Listen for changes to synced settings
  addSettingsSyncListener: function() {
    var self = this;
    chrome.storage.onChanged.addListener(function(remoteSettings, namespace) {
      if (namespace !== 'sync' || !remoteSettings) {
        return;
      }
      var shouldSync = self.getOption(self.SYNC_SETTINGS);
      if (shouldSync) {
        var localSettings = self.getSettings();
        var changedSettingKeys = [];
        var oldValueBySettingKey = {};
        var newValueBySettingKey = {};
        Object.keys(remoteSettings).forEach(function(key) {
          var remoteSetting = remoteSettings[key];
          if (localSettings[key] !== remoteSetting.newValue) {
            gsUtils.log(
              'gsStorage',
              'Changed value from sync',
              key,
              remoteSetting.newValue
            );
            changedSettingKeys.push(key);
            oldValueBySettingKey[key] = localSettings[key];
            newValueBySettingKey[key] = remoteSetting.newValue;
            localSettings[key] = remoteSetting.newValue;
          }
        });

        if (changedSettingKeys.length > 0) {
          self.saveSettings(localSettings);
          gsUtils.performPostSaveUpdates(
            changedSettingKeys,
            oldValueBySettingKey,
            newValueBySettingKey
          );
        }
      }
    });
  },

  //due to migration issues and new settings being added, i have built in some redundancy
  //here so that getOption will always return a valid value.
  getOption: function(prop) {
    var settings = this.getSettings();
    if (typeof settings[prop] === 'undefined' || settings[prop] === null) {
      settings[prop] = this.getSettingsDefaults()[prop];
      this.saveSettings(settings);
    }
    return settings[prop];
  },

  setOption: function(prop, value) {
    var settings = this.getSettings();
    settings[prop] = value;
    // gsUtils.log('gsStorage', 'gsStorage', 'setting prop: ' + prop + ' to value ' + value);
    this.saveSettings(settings);
  },

  getSettings: function() {
    var settings;
    try {
      settings = JSON.parse(localStorage.getItem('gsSettings'));
    } catch (e) {
      gsUtils.error(
        'gsStorage',
        'Failed to parse gsSettings: ',
        localStorage.getItem('gsSettings')
      );
    }
    if (!settings) {
      settings = this.getSettingsDefaults();
      this.saveSettings(settings);
    }
    return settings;
  },

  saveSettings: function(settings) {
    try {
      localStorage.setItem('gsSettings', JSON.stringify(settings));
      gsAnalytics.updateDimensions();
    } catch (e) {
      gsUtils.error(
        'gsStorage',
        'failed to save gsSettings to local storage',
        e
      );
    }
  },

  // Push settings to sync
  syncSettings: function() {
    var settings = this.getSettings();
    if (settings[this.SYNC_SETTINGS]) {
      // Since sync is a local setting, delete it to simplify things.
      delete settings[this.SYNC_SETTINGS];
      // gsUtils.log('gsStorage', 'gsStorage', 'Pushing local settings to sync', settings);
      chrome.storage.sync.set(settings, this.noop);
      if (chrome.runtime.lastError) {
        gsUtils.error(
          'gsStorage',
          'failed to save to chrome.storage.sync: ',
          chrome.runtime.lastError
        );
      }
    }
  },

  fetchLastVersion: function() {
    var version;
    try {
      version = JSON.parse(localStorage.getItem(this.APP_VERSION));
    } catch (e) {
      gsUtils.error(
        'gsStorage',
        'Failed to parse ' + this.APP_VERSION + ': ',
        localStorage.getItem(this.APP_VERSION)
      );
    }
    version = version || '0.0.0';
    return version + '';
  },
  setLastVersion: function(newVersion) {
    try {
      localStorage.setItem(this.APP_VERSION, JSON.stringify(newVersion));
    } catch (e) {
      gsUtils.error(
        'gsStorage',
        'failed to save ' + this.APP_VERSION + ' to local storage',
        e
      );
    }
  },
  isNewInstall: function() {},

  fetchNoticeVersion: function() {
    var lastNoticeVersion;
    try {
      lastNoticeVersion = JSON.parse(localStorage.getItem(this.LAST_NOTICE));
    } catch (e) {
      gsUtils.error(
        'gsStorage',
        'Failed to parse ' + this.LAST_NOTICE + ': ',
        localStorage.getItem(this.LAST_NOTICE)
      );
    }
    lastNoticeVersion = lastNoticeVersion || '0';
    return lastNoticeVersion + '';
  },
  setNoticeVersion: function(newVersion) {
    try {
      localStorage.setItem(this.LAST_NOTICE, JSON.stringify(newVersion));
    } catch (e) {
      gsUtils.error(
        'gsStorage',
        'failed to save ' + this.LAST_NOTICE + ' to local storage',
        e
      );
    }
  },

  fetchLastExtensionRecoveryTimestamp: function() {
    var lastExtensionRecoveryTimestamp;
    try {
      lastExtensionRecoveryTimestamp = JSON.parse(
        localStorage.getItem(this.LAST_EXTENSION_RECOVERY)
      );
    } catch (e) {
      gsUtils.error(
        'gsStorage',
        'Failed to parse ' + this.LAST_EXTENSION_RECOVERY + ': ',
        localStorage.getItem(this.LAST_EXTENSION_RECOVERY)
      );
    }
    return lastExtensionRecoveryTimestamp;
  },
  setLastExtensionRecoveryTimestamp: function(extensionRecoveryTimestamp) {
    try {
      localStorage.setItem(
        this.LAST_EXTENSION_RECOVERY,
        JSON.stringify(extensionRecoveryTimestamp)
      );
    } catch (e) {
      gsUtils.error(
        'gsStorage',
        'failed to save ' + this.LAST_EXTENSION_RECOVERY + ' to local storage',
        e
      );
    }
  },

  /**
   * INDEXEDDB FUNCTIONS
   */

  getDb: function() {
    var self = this;
    return new Promise(function(resolve, reject) {
      if (self.server) {
        resolve(self.server);
      } else {
        db.open({
          server: self.DB_SERVER,
          version: self.DB_VERSION,
          schema: self.getSchema,
        }).then(function(s) {
          self.server = s;
          resolve(s);
        });
      }
    });
  },

  getSchema: function() {
    // NOTE: Called directly from db.js so 'this' cannot be relied upon
    return {
      [gsStorage.DB_PREVIEWS]: {
        key: {
          keyPath: 'id',
          autoIncrement: true,
        },
        indexes: {
          id: {},
          url: {},
        },
      },
      [gsStorage.DB_SUSPENDED_TABINFO]: {
        key: {
          keyPath: 'id',
          autoIncrement: true,
        },
        indexes: {
          id: {},
          url: {},
        },
      },
      [gsStorage.DB_CURRENT_SESSIONS]: {
        key: {
          keyPath: 'id',
          autoIncrement: true,
        },
        indexes: {
          id: {},
          sessionId: {},
        },
      },
      [gsStorage.DB_SAVED_SESSIONS]: {
        key: {
          keyPath: 'id',
          autoIncrement: true,
        },
        indexes: {
          id: {},
          sessionId: {},
        },
      },
    };
  },

  fetchPreviewImage: function(tabUrl, callback) {
    var self = this;
    callback = typeof callback !== 'function' ? this.noop : callback;

    this.getDb()
      .then(function(s) {
        return s
          .query(self.DB_PREVIEWS, 'url')
          .only(tabUrl)
          .execute();
      })
      .then(function(results) {
        if (results.length > 0) {
          callback(results[0]);
        } else {
          callback(null);
        }
      })
      .catch(function(err) {
        gsUtils.error('gsStorage', err);
        callback(null);
      });
  },

  addPreviewImage: function(tabUrl, previewUrl, callback) {
    var self = this,
      server;
    callback = typeof callback !== 'function' ? this.noop : callback;

    this.getDb()
      .then(function(s) {
        server = s;
        return server
          .query(self.DB_PREVIEWS, 'url')
          .only(tabUrl)
          .execute();
      })
      .then(function(results) {
        if (results.length > 0) {
          return server.remove(self.DB_PREVIEWS, results[0].id);
        } else {
          return Promise.resolve();
        }
      })
      .then(function() {
        server.add(self.DB_PREVIEWS, { url: tabUrl, img: previewUrl });
        callback();
      });
  },

  addSuspendedTabInfo: function(tabProperties, callback) {
    var self = this,
      server;
    callback = typeof callback !== 'function' ? this.noop : callback;

    if (!tabProperties.url) {
      gsUtils.log('gsStorage', 'tabProperties.url not set.');
      callback();
      return;
    }

    //first check to see if tabProperties already exists
    this.getDb()
      .then(function(s) {
        server = s;
        return server
          .query(self.DB_SUSPENDED_TABINFO)
          .filter('url', tabProperties.url)
          .execute();
      })
      .then(function(results) {
        if (results.length > 0) {
          return server.remove(self.DB_SUSPENDED_TABINFO, results[0].id);
        } else {
          return Promise.resolve();
        }
      })
      .then(function() {
        server.add(self.DB_SUSPENDED_TABINFO, tabProperties).then(function() {
          callback();
        });
      });
  },

  fetchTabInfo: function(tabUrl) {
    var self = this;
    return this.getDb().then(function(s) {
      return s
        .query(self.DB_SUSPENDED_TABINFO, 'url')
        .only(tabUrl)
        .distinct()
        .desc()
        .execute()
        .then(function(results) {
          return results.length > 0 ? results[0] : null;
        });
    });
  },

  updateSession: function(session, callback) {
    var self = this;
    //if it's a saved session (prefixed with an underscore)
    var tableName =
      session.sessionId.indexOf('_') === 0
        ? self.DB_SAVED_SESSIONS
        : self.DB_CURRENT_SESSIONS;
    callback = typeof callback !== 'function' ? self.noop : callback;

    //first check to see if session id already exists
    self
      .fetchSessionBySessionId(session.sessionId)
      .then(function(matchingSession) {
        if (matchingSession) {
          session.id = matchingSession.id; //copy across id from matching session
          session.date = new Date().toISOString();
          return self.getDb().then(function(s) {
            return s.update(tableName, session); //then update based on that id
          });
        } else {
          return self.getDb().then(function(s) {
            return s.add(tableName, session);
          });
        }
      })
      .then(function(result) {
        if (result.length > 0) {
          callback(result[0]);
        }
      });
  },

  fetchCurrentSessions: function() {
    var self = this;
    return self.getDb().then(function(s) {
      return s
        .query(self.DB_CURRENT_SESSIONS)
        .all()
        .desc()
        .execute();
    });
  },

  fetchSessionBySessionId: function(sessionId) {
    //if it's a saved session (prefixed with an underscore)
    var tableName =
      sessionId.indexOf('_') === 0
        ? this.DB_SAVED_SESSIONS
        : this.DB_CURRENT_SESSIONS;

    return this.getDb().then(function(s) {
      return s
        .query(tableName, 'sessionId')
        .only(sessionId)
        .desc()
        .execute()
        .then(function(results) {
          if (results.length > 0) {
            // Remove any duplicates!!!
            if (results.length > 1) {
              gsUtils.error(
                'Duplicate sessions found for sessionId: ' +
                  sessionId +
                  '! Removing older ones..'
              );
              for (var session of results.slice(1)) {
                s.remove(tableName, session.id).then(res => {});
              }
            }
            return results[0];
          } else {
            return null;
          }
        });
    });
  },

  createSessionRestorePoint: function(currentVersion, newVersion) {
    var currentSession;
    var currentSessionId = gsSession.getSessionId();
    return this.fetchSessionBySessionId(currentSessionId)
      .then(function(session) {
        currentSession = session;
        return gsStorage.fetchCurrentSessions();
      })
      .then(function(sessions) {
        if (!currentSession && sessions && sessions.length > 0) {
          currentSession = sessions[0];
        }
        if (currentSession) {
          currentSession.name = 'Automatic save point for v' + currentVersion;
          currentSession[gsStorage.DB_SESSION_PRE_UPGRADE_KEY] = currentVersion;
          currentSession[gsStorage.DB_SESSION_POST_UPGRADE_KEY] = newVersion;
          return gsStorage.addToSavedSessions(currentSession);
        }
      })
      .finally(function() {
        return currentSession;
      });
  },

  fetchSessionRestorePoint: function(versionKey, versionValue) {
    var tableName = this.DB_SAVED_SESSIONS;
    return this.getDb().then(function(s) {
      return s
        .query(tableName)
        .filter(versionKey, versionValue)
        .distinct()
        .execute()
        .then(function(results) {
          return results.length > 0 ? results[0] : null;
        });
    });
  },

  fetchLastSession: function() {
    var self = this,
      currentSessionId,
      lastSession = null;

    currentSessionId = gsSession.getSessionId();
    return this.getDb().then(function(s) {
      return s
        .query(self.DB_CURRENT_SESSIONS, 'id')
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

  fetchSavedSessions: function() {
    var self = this;
    return this.getDb().then(function(s) {
      return s
        .query(self.DB_SAVED_SESSIONS)
        .all()
        .execute();
    });
  },

  addToSavedSessions: function(session, callback) {
    callback = typeof callback !== 'function' ? this.noop : callback;

    //if sessionId does not already have an underscore prefix then generate a new unique sessionId for this saved session
    if (session.sessionId.indexOf('_') < 0) {
      session.sessionId = '_' + gsUtils.generateHashCode(session.name);
    }

    //clear id as it will be either readded (if sessionId match found) or generated (if creating a new session)
    delete session.id;

    this.updateSession(session, callback);
  },

  clearGsSessions: function() {
    var self = this;

    this.getDb().then(function(s) {
      s.clear(self.DB_CURRENT_SESSIONS);
    });
  },

  removeTabFromSessionHistory: function(sessionId, windowId, tabId, callback) {
    var self = this,
      matched;

    callback = typeof callback !== 'function' ? this.noop : callback;

    this.fetchSessionBySessionId(sessionId).then(function(gsSession) {
      gsSession.windows.some(function(curWindow, windowIndex) {
        matched = curWindow.tabs.some(function(curTab, tabIndex) {
          //leave this as a loose matching as sometimes it is comparing strings. other times ints
          if (curTab.id == tabId || curTab.url == tabId) {
            // eslint-disable-line eqeqeq
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
          callback();
        });
      }
    });
  },

  removeSessionFromHistory: function(sessionId, callback) {
    var server,
      session,
      tableName =
        sessionId.indexOf('_') === 0
          ? this.DB_SAVED_SESSIONS
          : this.DB_CURRENT_SESSIONS;

    callback = typeof callback !== 'function' ? this.noop : callback;

    this.getDb()
      .then(function(s) {
        server = s;
        return server
          .query(tableName)
          .filter('sessionId', sessionId)
          .execute();
      })
      .then(function(result) {
        if (result.length > 0) {
          session = result[0];
          server.remove(tableName, session.id);
        }
      })
      .then(callback);
  },

  trimDbItems: function() {
    var self = this,
      server,
      maxTabItems = 1000,
      maxHistories = 5,
      itemsToRemove,
      i;

    this.getDb()
      .then(function(s) {
        server = s;
        return server
          .query(self.DB_SUSPENDED_TABINFO, 'id')
          .all()
          .keys()
          .execute();

        //trim suspendedTabInfo
      })
      .then(function(results) {
        //if there are more than maxTabItems items, then remove the oldest ones
        if (results.length > maxTabItems) {
          itemsToRemove = results.length - maxTabItems;
          for (i = 0; i < itemsToRemove; i++) {
            server.remove(self.DB_SUSPENDED_TABINFO, results[i]);
          }
        }

        return server
          .query(self.DB_PREVIEWS, 'id')
          .all()
          .keys()
          .execute();

        //trim imagePreviews
      })
      .then(function(results) {
        //if there are more than maxTabItems items, then remove the oldest ones
        if (results.length > maxTabItems) {
          itemsToRemove = results.length - maxTabItems;
          for (i = 0; i < itemsToRemove; i++) {
            server.remove(self.DB_PREVIEWS, results[i]);
          }
        }

        return server
          .query(self.DB_CURRENT_SESSIONS, 'id')
          .all()
          .keys()
          .execute();

        //trim currentSessions
      })
      .then(function(results) {
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
   * MIGRATIONS
   */

  performMigration: function(oldVersion) {
    var self = this,
      server;

    var extensionName = chrome.runtime.getManifest().name || '';

    var major = parseInt(oldVersion.split('.')[0] || 0),
      minor = parseInt(oldVersion.split('.')[1] || 0),
      testMode = extensionName.includes('Test');
    // patch = parseInt(oldVersion.split('.')[2] || 0);

    //perform migrated history fixup
    if (major < 6 || (major === 6 && minor < 13)) {
      // if (oldVersion < 6.13)

      //fix up migrated saved session and newly saved session sessionIds
      this.getDb()
        .then(function(s) {
          server = s;
          return s
            .query(self.DB_SAVED_SESSIONS)
            .all()
            .execute();
        })
        .then(function(savedSessions) {
          savedSessions.forEach(function(session, index) {
            if (session.id === 7777) {
              session.sessionId = '_7777';
              session.name = 'Recovered tabs';
              session.date = new Date(session.date).toISOString();
            } else {
              session.sessionId = '_' + gsUtils.generateHashCode(session.name);
            }
            server.update(self.DB_SAVED_SESSIONS, session);
          });
        });
    }
    if (major < 6 || (major === 6 && minor < 30)) {
      // if (oldVersion < 6.30)

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
    if (major < 6 || (major === 6 && minor < 31) || testMode) {
      // if (oldVersion < 6.31)
      chrome.cookies.getAll({}, function(cookies) {
        var scrollPosByTabId = {};
        cookies.forEach(function(cookie) {
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
            chrome.cookies.remove({ url: url, name: cookie.name });
          }
        });
        tgs.scrollPosByTabId = scrollPosByTabId;
      });
    }
  },
};
