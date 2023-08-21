/*global chrome, gsSession, localStorage, gsUtils */
'use strict';

var gsStorage = {
  SCREEN_CAPTURE: 'screenCapture',
  SCREEN_CAPTURE_FORCE: 'screenCaptureForce',
  SUSPEND_IN_PLACE_OF_DISCARD: 'suspendInPlaceOfDiscard',
  UNSUSPEND_ON_FOCUS: 'gsUnsuspendOnFocus',
  SUSPEND_TIME: 'gsTimeToSuspend',
  IGNORE_WHEN_OFFLINE: 'onlineCheck',
  IGNORE_WHEN_CHARGING: 'batteryCheck',
  CLAIM_BY_DEFAULT: 'claimByDefault',
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

  UPDATE_AVAILABLE: 'gsUpdateAvailable',

  noop: function() {
  },

  getSettingsDefaults: function() {
    const defaults = {};
    defaults[gsStorage.SCREEN_CAPTURE] = '0';
    defaults[gsStorage.SCREEN_CAPTURE_FORCE] = false;
    defaults[gsStorage.SUSPEND_IN_PLACE_OF_DISCARD] = false;
    defaults[gsStorage.DISCARD_IN_PLACE_OF_SUSPEND] = false;
    defaults[gsStorage.DISCARD_AFTER_SUSPEND] = false;
    defaults[gsStorage.IGNORE_WHEN_OFFLINE] = false;
    defaults[gsStorage.IGNORE_WHEN_CHARGING] = false;
    defaults[gsStorage.CLAIM_BY_DEFAULT] = false;
    defaults[gsStorage.UNSUSPEND_ON_FOCUS] = false;
    defaults[gsStorage.IGNORE_PINNED] = true;
    defaults[gsStorage.IGNORE_FORMS] = true;
    defaults[gsStorage.IGNORE_AUDIO] = true;
    defaults[gsStorage.IGNORE_ACTIVE_TABS] = true;
    defaults[gsStorage.IGNORE_CACHE] = false;
    defaults[gsStorage.ADD_CONTEXT] = true;
    defaults[gsStorage.SYNC_SETTINGS] = true;
    defaults[gsStorage.SUSPEND_TIME] = '60';
    defaults[gsStorage.NO_NAG] = false;
    defaults[gsStorage.WHITELIST] = '';
    defaults[gsStorage.THEME] = 'light';
    defaults[gsStorage.UPDATE_AVAILABLE] = false; //Set to true for debug

    return defaults;
  },

  /**
   * LOCAL STORAGE FUNCTIONS
   */

  //populate localstorage settings with sync settings where undefined
  initSettingsAsPromised: function() {
    return new Promise(function(resolve) {
      var defaultSettings = gsStorage.getSettingsDefaults();
      var defaultKeys = Object.keys(defaultSettings);
      chrome.storage.sync.get(defaultKeys, function(syncedSettings) {
        gsUtils.log('gsStorage', 'syncedSettings on init: ', syncedSettings);
        gsSession.setSynchedSettingsOnInit(syncedSettings);

        var rawLocalSettings;
        try {
          rawLocalSettings = JSON.parse(localStorage.getItem('gsSettings'));
        } catch (e) {
          gsUtils.error(
            'gsStorage',
            'Failed to parse gsSettings: ',
            localStorage.getItem('gsSettings'),
          );
        }
        if (!rawLocalSettings) {
          rawLocalSettings = {};
        } else {
          //if we have some rawLocalSettings but SYNC_SETTINGS is not defined
          //then define it as FALSE (as opposed to default of TRUE)
          rawLocalSettings[gsStorage.SYNC_SETTINGS] =
            rawLocalSettings[gsStorage.SYNC_SETTINGS] || false;
        }
        gsUtils.log('gsStorage', 'localSettings on init: ', rawLocalSettings);
        var shouldSyncSettings = rawLocalSettings[gsStorage.SYNC_SETTINGS];

        var mergedSettings = {};
        for (const key of defaultKeys) {
          if (key === gsStorage.SYNC_SETTINGS) {
            if (chrome.extension.inIncognitoContext) {
              mergedSettings[key] = false;
            } else {
              mergedSettings[key] = rawLocalSettings.hasOwnProperty(key)
                ? rawLocalSettings[key]
                : defaultSettings[key];
            }
            continue;
          }
          // If nags are disabled locally, then ensure we disable them on synced profile
          if (
            key === gsStorage.NO_NAG &&
            shouldSyncSettings &&
            rawLocalSettings.hasOwnProperty(gsStorage.NO_NAG) &&
            rawLocalSettings[gsStorage.NO_NAG]
          ) {
            mergedSettings[gsStorage.NO_NAG] = true;
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
            gsUtils.errorIfInitialised(
              'gsStorage',
              'Missing key: ' + key + '! Will init with default.',
            );
            mergedSettings[key] = defaultSettings[key];
          }
        }
        gsStorage.saveSettings(mergedSettings);
        gsUtils.log('gsStorage', 'mergedSettings: ', mergedSettings);

        // if any of the new settings are different to those in sync, then trigger a resync
        var triggerResync = false;
        for (const key of defaultKeys) {
          if (
            key !== gsStorage.SYNC_SETTINGS &&
            syncedSettings[key] !== mergedSettings[key]
          ) {
            triggerResync = true;
          }
        }
        if (triggerResync) {
          gsStorage.syncSettings();
        }
        gsStorage.addSettingsSyncListener();
        gsUtils.log('gsStorage', 'init successful');
        resolve();
      });
    });
  },

  // Listen for changes to synced settings
  addSettingsSyncListener: function() {
    chrome.storage.onChanged.addListener(function(remoteSettings, namespace) {
      if (namespace !== 'sync' || !remoteSettings) {
        return;
      }
      var shouldSync = gsStorage.getOption(gsStorage.SYNC_SETTINGS);
      if (shouldSync) {
        var localSettings = gsStorage.getSettings();
        var changedSettingKeys = [];
        var oldValueBySettingKey = {};
        var newValueBySettingKey = {};
        Object.keys(remoteSettings).forEach(function(key) {
          var remoteSetting = remoteSettings[key];

          // If nags are disabled locally, then ensure we disable them on synced profile
          if (key === gsStorage.NO_NAG) {
            if (remoteSetting.newValue === false) {
              return false; // don't process this key
            }
          }

          if (localSettings[key] !== remoteSetting.newValue) {
            gsUtils.log(
              'gsStorage',
              'Changed value from sync',
              key,
              remoteSetting.newValue,
            );
            changedSettingKeys.push(key);
            oldValueBySettingKey[key] = localSettings[key];
            newValueBySettingKey[key] = remoteSetting.newValue;
            localSettings[key] = remoteSetting.newValue;
          }
        });

        if (changedSettingKeys.length > 0) {
          gsStorage.saveSettings(localSettings);
          gsUtils.performPostSaveUpdates(
            changedSettingKeys,
            oldValueBySettingKey,
            newValueBySettingKey,
          );
        }
      }
    });
  },

  //due to migration issues and new settings being added, i have built in some redundancy
  //here so that getOption will always return a valid value.
  getOption: function(prop) {
    var settings = gsStorage.getSettings();
    if (typeof settings[prop] === 'undefined' || settings[prop] === null) {
      settings[prop] = gsStorage.getSettingsDefaults()[prop];
      gsStorage.saveSettings(settings);
    }
    return settings[prop];
  },

  setOption: function(prop, value) {
    var settings = gsStorage.getSettings();
    settings[prop] = value;
    // gsUtils.log('gsStorage', 'gsStorage', 'setting prop: ' + prop + ' to value ' + value);
    gsStorage.saveSettings(settings);
  },

  // Important to note that setOption (and ultimately saveSettings) uses localStorage whereas
  // syncSettings saves to chrome.storage.
  // Calling syncSettings has the unfortunate side-effect of triggering the chrome.storage.onChanged
  // listener which the re-saves the setting to localStorage a second time.
  setOptionAndSync: function(prop, value) {
    gsStorage.setOption(prop, value);
    gsStorage.syncSettings();
  },

  getSettings: function() {
    var settings;
    try {
      settings = JSON.parse(localStorage.getItem('gsSettings'));
    } catch (e) {
      gsUtils.error(
        'gsStorage',
        'Failed to parse gsSettings: ',
        localStorage.getItem('gsSettings'),
      );
    }
    if (!settings) {
      settings = gsStorage.getSettingsDefaults();
      gsStorage.saveSettings(settings);
    }
    return settings;
  },

  saveSettings: function(settings) {
    try {
      localStorage.setItem('gsSettings', JSON.stringify(settings));
    } catch (e) {
      gsUtils.error(
        'gsStorage',
        'failed to save gsSettings to local storage',
        e,
      );
    }
  },

  // Push settings to sync
  syncSettings: function() {
    var settings = gsStorage.getSettings();
    if (settings[gsStorage.SYNC_SETTINGS]) {
      // Since sync is a local setting, delete it to simplify things.
      delete settings[gsStorage.SYNC_SETTINGS];
      gsUtils.log(
        'gsStorage',
        'gsStorage',
        'Pushing local settings to sync',
        settings,
      );
      chrome.storage.sync.set(settings, () => {
        if (chrome.runtime.lastError) {
          gsUtils.error(
            'gsStorage',
            'failed to save to chrome.storage.sync: ',
            chrome.runtime.lastError,
          );
        }
      });
    }
  },

  fetchLastVersion: function() {
    var version;
    try {
      version = JSON.parse(localStorage.getItem(gsStorage.APP_VERSION));
    } catch (e) {
      gsUtils.error(
        'gsStorage',
        'Failed to parse ' + gsStorage.APP_VERSION + ': ',
        localStorage.getItem(gsStorage.APP_VERSION),
      );
    }
    version = version || '0.0.0';
    return version + '';
  },

  setLastVersion: function(newVersion) {
    try {
      localStorage.setItem(gsStorage.APP_VERSION, JSON.stringify(newVersion));
    } catch (e) {
      gsUtils.error(
        'gsStorage',
        'failed to save ' + gsStorage.APP_VERSION + ' to local storage',
        e,
      );
    }
  },

  setNoticeVersion: function(newVersion) {
    try {
      localStorage.setItem(gsStorage.LAST_NOTICE, JSON.stringify(newVersion));
    } catch (e) {
      gsUtils.error(
        'gsStorage',
        'failed to save ' + gsStorage.LAST_NOTICE + ' to local storage',
        e,
      );
    }
  },

  fetchLastExtensionRecoveryTimestamp: function() {
    var lastExtensionRecoveryTimestamp;
    try {
      lastExtensionRecoveryTimestamp = JSON.parse(
        localStorage.getItem(gsStorage.LAST_EXTENSION_RECOVERY),
      );
    } catch (e) {
      gsUtils.error(
        'gsStorage',
        'Failed to parse ' + gsStorage.LAST_EXTENSION_RECOVERY + ': ',
        localStorage.getItem(gsStorage.LAST_EXTENSION_RECOVERY),
      );
    }
    return lastExtensionRecoveryTimestamp;
  },
  setLastExtensionRecoveryTimestamp: function(extensionRecoveryTimestamp) {
    try {
      localStorage.setItem(
        gsStorage.LAST_EXTENSION_RECOVERY,
        JSON.stringify(extensionRecoveryTimestamp),
      );
    } catch (e) {
      gsUtils.error(
        'gsStorage',
        'failed to save ' +
        gsStorage.LAST_EXTENSION_RECOVERY +
        ' to local storage',
        e,
      );
    }
  },

};
