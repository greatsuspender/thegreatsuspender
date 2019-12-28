'use strict';

import { setUserDimensions } from './gsAnalytics';
import { setSynchedSettingsOnInit } from './gsSession';
import {
  log,
  error,
  errorIfInitialised,
  performPostSaveUpdates,
  hasProperty,
} from './gsUtils';

export const SCREEN_CAPTURE = 'screenCapture';
export const SCREEN_CAPTURE_FORCE = 'screenCaptureForce';
export const SUSPEND_IN_PLACE_OF_DISCARD = 'suspendInPlaceOfDiscard';
export const UNSUSPEND_ON_FOCUS = 'gsUnsuspendOnFocus';
export const SUSPEND_TIME = 'gsTimeToSuspend';
export const IGNORE_WHEN_OFFLINE = 'onlineCheck';
export const IGNORE_WHEN_CHARGING = 'batteryCheck';
export const IGNORE_PINNED = 'gsDontSuspendPinned';
export const IGNORE_FORMS = 'gsDontSuspendForms';
export const IGNORE_AUDIO = 'gsDontSuspendAudio';
export const IGNORE_ACTIVE_TABS = 'gsDontSuspendActiveTabs';
export const IGNORE_CACHE = 'gsIgnoreCache';
export const ADD_CONTEXT = 'gsAddContextMenu';
export const SYNC_SETTINGS = 'gsSyncSettings';
export const NO_NAG = 'gsNoNag';
export const THEME = 'gsTheme';
export const WHITELIST = 'gsWhitelist';
export const DISCARD_AFTER_SUSPEND = 'discardAfterSuspend';
export const DISCARD_IN_PLACE_OF_SUSPEND = 'discardInPlaceOfSuspend';
export const USE_ALT_SCREEN_CAPTURE_LIB = 'useAlternateScreenCaptureLib';

export const APP_VERSION = 'gsVersion';
export const LAST_NOTICE = 'gsNotice';
export const LAST_EXTENSION_RECOVERY = 'gsExtensionRecovery';

export const SM_SESSION_METRICS = 'gsSessionMetrics';
export const SM_TIMESTAMP = 'sessionTimestamp';
export const SM_SUSPENDED_TAB_COUNT = 'suspendedTabCount';
export const SM_TOTAL_TAB_COUNT = 'totalTabCount';

export const getSettingsDefaults = () => {
  const defaults = {};
  defaults[SCREEN_CAPTURE] = '0';
  defaults[SCREEN_CAPTURE_FORCE] = false;
  defaults[SUSPEND_IN_PLACE_OF_DISCARD] = false;
  defaults[DISCARD_IN_PLACE_OF_SUSPEND] = false;
  defaults[USE_ALT_SCREEN_CAPTURE_LIB] = false;
  defaults[DISCARD_AFTER_SUSPEND] = false;
  defaults[IGNORE_WHEN_OFFLINE] = false;
  defaults[IGNORE_WHEN_CHARGING] = false;
  defaults[UNSUSPEND_ON_FOCUS] = false;
  defaults[IGNORE_PINNED] = true;
  defaults[IGNORE_FORMS] = true;
  defaults[IGNORE_AUDIO] = true;
  defaults[IGNORE_ACTIVE_TABS] = true;
  defaults[IGNORE_CACHE] = false;
  defaults[ADD_CONTEXT] = true;
  defaults[SYNC_SETTINGS] = true;
  defaults[SUSPEND_TIME] = '60';
  defaults[NO_NAG] = false;
  defaults[WHITELIST] = '';
  defaults[THEME] = 'light';

  return defaults;
};

/**
 * LOCAL STORAGE FUNCTIONS
 */

//populate localstorage settings with sync settings where undefined
export const initSettingsAsPromised = () => {
  return new Promise(function(resolve) {
    const defaultSettings = getSettingsDefaults();
    const defaultKeys = Object.keys(defaultSettings);
    chrome.storage.sync.get(defaultKeys, function(syncedSettings) {
      log('gsStorage', 'syncedSettings on init: ', syncedSettings);
      setSynchedSettingsOnInit(syncedSettings);

      let rawLocalSettings;
      try {
        rawLocalSettings = JSON.parse(localStorage.getItem('gsSettings'));
      } catch (e) {
        error(
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
        rawLocalSettings[SYNC_SETTINGS] =
          rawLocalSettings[SYNC_SETTINGS] || false;
      }
      log('gsStorage', 'localSettings on init: ', rawLocalSettings);
      const shouldSyncSettings = rawLocalSettings[SYNC_SETTINGS];

      const mergedSettings = {};
      for (const key of defaultKeys) {
        if (key === SYNC_SETTINGS) {
          if (chrome.extension.inIncognitoContext) {
            mergedSettings[key] = false;
          } else {
            mergedSettings[key] = hasProperty(rawLocalSettings, key)
              ? rawLocalSettings[key]
              : defaultSettings[key];
          }
          continue;
        }
        // If donations are disabled locally, then ensure we disable them on synced profile
        if (
          key === NO_NAG &&
          shouldSyncSettings &&
          hasProperty(rawLocalSettings, NO_NAG) &&
          rawLocalSettings[NO_NAG]
        ) {
          mergedSettings[NO_NAG] = true;
          continue;
        }
        // if synced setting exists and local setting does not exist or
        // syncing is enabled locally then overwrite with synced value
        if (
          hasProperty(syncedSettings, key) &&
          (!hasProperty(rawLocalSettings, key) || shouldSyncSettings)
        ) {
          mergedSettings[key] = syncedSettings[key];
        }
        //fallback on rawLocalSettings
        if (!hasProperty(mergedSettings, key)) {
          mergedSettings[key] = rawLocalSettings[key];
        }
        //fallback on defaultSettings
        if (
          typeof mergedSettings[key] === 'undefined' ||
          mergedSettings[key] === null
        ) {
          errorIfInitialised(
            'gsStorage',
            'Missing key: ' + key + '! Will init with default.'
          );
          mergedSettings[key] = defaultSettings[key];
        }
      }
      saveSettings(mergedSettings);
      log('gsStorage', 'mergedSettings: ', mergedSettings);

      // if any of the new settings are different to those in sync, then trigger a resync
      let triggerResync = false;
      for (const key of defaultKeys) {
        if (
          key !== SYNC_SETTINGS &&
          syncedSettings[key] !== mergedSettings[key]
        ) {
          triggerResync = true;
        }
      }
      if (triggerResync) {
        syncSettings();
      }
      addSettingsSyncListener();
      log('gsStorage', 'init successful');
      resolve();
    });
  });
};

// Listen for changes to synced settings
export const addSettingsSyncListener = () => {
  chrome.storage.onChanged.addListener(function(remoteSettings, namespace) {
    if (namespace !== 'sync' || !remoteSettings) {
      return;
    }
    const shouldSync = getOption(SYNC_SETTINGS);
    if (shouldSync) {
      const localSettings = getSettings();
      const changedSettingKeys = [];
      const oldValueBySettingKey = {};
      const newValueBySettingKey = {};
      Object.keys(remoteSettings).forEach(function(key) {
        const remoteSetting = remoteSettings[key];

        // If donations are disabled locally, then ensure we disable them on synced profile
        if (key === NO_NAG) {
          if (remoteSetting.newValue === false) {
            return false; // don't process this key
          }
        }

        if (localSettings[key] !== remoteSetting.newValue) {
          log(
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
        saveSettings(localSettings);
        performPostSaveUpdates(
          changedSettingKeys,
          oldValueBySettingKey,
          newValueBySettingKey
        );
      }
    }
  });
};

//due to migration issues and new settings being added, i have built in some redundancy
//here so that getOption will always return a valid value.
export const getOption = prop => {
  const settings = getSettings();
  if (typeof settings[prop] === 'undefined' || settings[prop] === null) {
    settings[prop] = getSettingsDefaults()[prop];
    saveSettings(settings);
  }
  return settings[prop];
};

export const setOption = (prop, value) => {
  const settings = getSettings();
  settings[prop] = value;
  // log('gsStorage', 'gsStorage', 'setting prop: ' + prop + ' to value ' + value);
  saveSettings(settings);
};

// Important to note that setOption (and ultimately saveSettings) uses localStorage whereas
// syncSettings saves to chrome.storage.
// Calling syncSettings has the unfortunate side-effect of triggering the chrome.storage.onChanged
// listener which the re-saves the setting to localStorage a second time.
export const setOptionAndSync = (prop, value) => {
  setOption(prop, value);
  syncSettings();
};

export const getSettings = () => {
  let settings;
  try {
    settings = JSON.parse(localStorage.getItem('gsSettings'));
  } catch (e) {
    error(
      'gsStorage',
      'Failed to parse gsSettings: ',
      localStorage.getItem('gsSettings')
    );
  }
  if (!settings) {
    settings = getSettingsDefaults();
    saveSettings(settings);
  }
  return settings;
};

export const saveSettings = settings => {
  try {
    localStorage.setItem('gsSettings', JSON.stringify(settings));
    setUserDimensions();
  } catch (e) {
    error('gsStorage', 'failed to save gsSettings to local storage', e);
  }
};

// Push settings to sync
export const syncSettings = () => {
  const settings = getSettings();
  if (settings[SYNC_SETTINGS]) {
    // Since sync is a local setting, delete it to simplify things.
    delete settings[SYNC_SETTINGS];
    log('gsStorage', 'gsStorage', 'Pushing local settings to sync', settings);
    chrome.storage.sync.set(settings, () => {
      if (chrome.runtime.lastError) {
        error(
          'gsStorage',
          'failed to save to chrome.storage.sync: ',
          chrome.runtime.lastError
        );
      }
    });
  }
};

export const fetchLastVersion = () => {
  let version;
  try {
    version = JSON.parse(localStorage.getItem(APP_VERSION));
  } catch (e) {
    error(
      'gsStorage',
      'Failed to parse ' + APP_VERSION + ': ',
      localStorage.getItem(APP_VERSION)
    );
  }
  version = version || '0.0.0';
  return version + '';
};
export const setLastVersion = newVersion => {
  try {
    localStorage.setItem(APP_VERSION, JSON.stringify(newVersion));
  } catch (e) {
    error(
      'gsStorage',
      'failed to save ' + APP_VERSION + ' to local storage',
      e
    );
  }
};

export const fetchNoticeVersion = () => {
  let lastNoticeVersion;
  try {
    lastNoticeVersion = JSON.parse(localStorage.getItem(LAST_NOTICE));
  } catch (e) {
    error(
      'gsStorage',
      'Failed to parse ' + LAST_NOTICE + ': ',
      localStorage.getItem(LAST_NOTICE)
    );
  }
  lastNoticeVersion = lastNoticeVersion || '0';
  return lastNoticeVersion + '';
};
export const setNoticeVersion = newVersion => {
  try {
    localStorage.setItem(LAST_NOTICE, JSON.stringify(newVersion));
  } catch (e) {
    error(
      'gsStorage',
      'failed to save ' + LAST_NOTICE + ' to local storage',
      e
    );
  }
};

export const fetchLastExtensionRecoveryTimestamp = () => {
  let lastExtensionRecoveryTimestamp;
  try {
    lastExtensionRecoveryTimestamp = JSON.parse(
      localStorage.getItem(LAST_EXTENSION_RECOVERY)
    );
  } catch (e) {
    error(
      'gsStorage',
      'Failed to parse ' + LAST_EXTENSION_RECOVERY + ': ',
      localStorage.getItem(LAST_EXTENSION_RECOVERY)
    );
  }
  return lastExtensionRecoveryTimestamp;
};
export const setLastExtensionRecoveryTimestamp = extensionRecoveryTimestamp => {
  try {
    localStorage.setItem(
      LAST_EXTENSION_RECOVERY,
      JSON.stringify(extensionRecoveryTimestamp)
    );
  } catch (e) {
    error(
      'gsStorage',
      'failed to save ' + LAST_EXTENSION_RECOVERY + ' to local storage',
      e
    );
  }
};

export const fetchSessionMetrics = () => {
  let sessionMetrics = {};
  try {
    sessionMetrics = JSON.parse(localStorage.getItem(SM_SESSION_METRICS));
  } catch (e) {
    error(
      'gsStorage',
      'Failed to parse ' + SM_SESSION_METRICS + ': ',
      localStorage.getItem(SM_SESSION_METRICS)
    );
  }
  return sessionMetrics;
};
export const setSessionMetrics = sessionMetrics => {
  try {
    localStorage.setItem(SM_SESSION_METRICS, JSON.stringify(sessionMetrics));
  } catch (e) {
    error(
      'gsStorage',
      'failed to save ' + SM_SESSION_METRICS + ' to local storage',
      e
    );
  }
};
