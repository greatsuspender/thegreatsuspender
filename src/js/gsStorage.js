/*global chrome, localStorage, gsUtils, gsAnalytics */
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
};
