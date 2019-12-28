import db from './db';
import { log, warning, error, generateHashCode } from './gsUtils';
import { getSessionId } from './gsSession';
import { cookiesGetAll, cookiesRemove } from './gsChrome';
import { SCREEN_CAPTURE, getOption, setOption } from './gsStorage';

let DB_SERVER = 'tgs';

export const DB_VERSION = '3';
export const DB_PREVIEWS = 'gsPreviews';
export const DB_SUSPENDED_TABINFO = 'gsSuspendedTabInfo';
export const DB_FAVICON_META = 'gsFaviconMeta';
export const DB_CURRENT_SESSIONS = 'gsCurrentSessions';
export const DB_SAVED_SESSIONS = 'gsSavedSessions';
export const DB_SESSION_PRE_UPGRADE_KEY = 'preUpgradeVersion';

let server = null;

export const getDb = async () => {
  if (!server) {
    server = await db.open({
      server: DB_SERVER,
      version: DB_VERSION,
      schema: getSchema,
    });
  }
  return server;
};

export const getSchema = () => {
  // NOTE: Called directly from db.js so 'this' cannot be relied upon
  return {
    [DB_PREVIEWS]: {
      key: {
        keyPath: 'id',
        autoIncrement: true,
      },
      indexes: {
        id: {},
        url: {},
      },
    },
    [DB_SUSPENDED_TABINFO]: {
      key: {
        keyPath: 'id',
        autoIncrement: true,
      },
      indexes: {
        id: {},
        url: {},
      },
    },
    [DB_FAVICON_META]: {
      key: {
        keyPath: 'id',
        autoIncrement: true,
      },
      indexes: {
        id: {},
        url: {},
      },
    },
    [DB_CURRENT_SESSIONS]: {
      key: {
        keyPath: 'id',
        autoIncrement: true,
      },
      indexes: {
        id: {},
        sessionId: {},
      },
    },
    [DB_SAVED_SESSIONS]: {
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
};

export const fetchPreviewImage = async tabUrl => {
  let results;
  try {
    const gsDb = await getDb();
    results = await gsDb
      .query(DB_PREVIEWS, 'url')
      .only(tabUrl)
      .execute();
  } catch (e) {
    error('gsIndexedDb', e);
  }
  if (results && results.length > 0) {
    return results[0];
  }
  return null;
};

export const addPreviewImage = async (tabUrl, previewUrl) => {
  try {
    const gsDb = await getDb();
    const results = await gsDb
      .query(DB_PREVIEWS, 'url')
      .only(tabUrl)
      .execute();
    if (results.length > 0) {
      for (const result of results) {
        await gsDb.remove(DB_PREVIEWS, result.id);
      }
    }
    await gsDb.add(DB_PREVIEWS, { url: tabUrl, img: previewUrl });
  } catch (e) {
    error('gsIndexedDb', e);
  }
};

export const addSuspendedTabInfo = async tabProperties => {
  try {
    if (!tabProperties.url) {
      error('gsIndexedDb', 'tabProperties.url not set.');
      return;
    }
    const gsDb = await getDb();
    const results = await gsDb
      .query(DB_SUSPENDED_TABINFO)
      .filter('url', tabProperties.url)
      .execute();
    if (results.length > 0) {
      for (const result of results) {
        await gsDb.remove(DB_SUSPENDED_TABINFO, result.id);
      }
    }
    await gsDb.add(DB_SUSPENDED_TABINFO, tabProperties);
  } catch (e) {
    error('gsIndexedDb', e);
  }
};

export const fetchTabInfo = async tabUrl => {
  let results;
  try {
    const gsDb = await getDb();
    results = await gsDb
      .query(DB_SUSPENDED_TABINFO, 'url')
      .only(tabUrl)
      .distinct()
      .desc()
      .execute();
  } catch (e) {
    error('gsIndexedDb', e);
  }
  if (results && results.length > 0) {
    const tabInfo = results[0];
    //Temporary code
    if (tabInfo.favicon) {
      if (!tabInfo.favIconUrl) {
        tabInfo.favIconUrl = tabInfo.favicon;
      }
      delete tabInfo.favicon;
    }
    return tabInfo;
  }
  return null;
};

export const addFaviconMeta = async (url, faviconMeta) => {
  try {
    if (!url) {
      error('gsIndexedDb', 'url not set.');
      return;
    }
    const faviconMetaWithUrl = Object.assign(faviconMeta, { url });
    const gsDb = await getDb();
    const results = await gsDb
      .query(DB_FAVICON_META)
      .filter('url', url)
      .execute();
    if (results.length > 0) {
      for (const result of results) {
        await gsDb.remove(DB_FAVICON_META, result.id);
      }
    }
    await gsDb.add(DB_FAVICON_META, faviconMetaWithUrl);
  } catch (e) {
    error('gsIndexedDb', e);
  }
};

export const fetchFaviconMeta = async url => {
  let results;
  try {
    const gsDb = await getDb();
    results = await gsDb
      .query(DB_FAVICON_META, 'url')
      .only(url)
      .distinct()
      .desc()
      .execute();
  } catch (e) {
    error('gsIndexedDb', e);
  }
  if (results && results.length > 0) {
    const faviconMeta = results[0];
    return faviconMeta;
  }
  return null;
};

export const updateSession = async session => {
  try {
    const gsDb = await getDb();

    //if it's a saved session (prefixed with an underscore)
    const tableName =
      session.sessionId.indexOf('_') === 0
        ? DB_SAVED_SESSIONS
        : DB_CURRENT_SESSIONS;

    //first check to see if session id already exists
    const matchingSession = await fetchSessionBySessionId(session.sessionId);
    if (matchingSession) {
      log('gsIndexedDb', 'Updating existing session: ' + session.sessionId);
      session.id = matchingSession.id; //copy across id from matching session
      session.date = new Date().toISOString();
      await gsDb.update(tableName, session); //then update based on that id
    } else {
      log('gsIndexedDb', 'Creating new session: ' + session.sessionId);
      await gsDb.add(tableName, session);
    }
  } catch (e) {
    error('gsIndexedDb', e);
  }
};

export const fetchCurrentSessions = async () => {
  let results;
  try {
    const gsDb = await getDb();
    results = await gsDb
      .query(DB_CURRENT_SESSIONS)
      .all()
      .desc()
      .execute();
  } catch (e) {
    error('gsIndexedDb', e);
    results = [];
  }
  return results;
};

export const fetchSessionBySessionId = async sessionId => {
  let results;
  try {
    const gsDb = await getDb();

    //if it's a saved session (prefixed with an underscore)
    const tableName =
      sessionId.indexOf('_') === 0 ? DB_SAVED_SESSIONS : DB_CURRENT_SESSIONS;
    results = await gsDb
      .query(tableName, 'sessionId')
      .only(sessionId)
      .desc()
      .execute();

    if (results.length > 1) {
      warning(
        'gsIndexedDb',
        'Duplicate sessions found for sessionId: ' +
          sessionId +
          '! Removing older ones..'
      );
      for (const session of results.slice(1)) {
        await gsDb.remove(tableName, session.id);
      }
    }
  } catch (e) {
    error('gsIndexedDb', e);
  }
  if (results && results.length > 0) {
    return results[0];
  }
  return null;
};

export const createOrUpdateSessionRestorePoint = async (session, version) => {
  const existingSessionRestorePoint = await fetchSessionRestorePoint(version);
  if (existingSessionRestorePoint) {
    existingSessionRestorePoint.windows = session.windows;
    await updateSession(existingSessionRestorePoint);
    log('gsIndexedDb', 'Updated automatic session restore point');
  } else {
    session.name = chrome.i18n.getMessage('js_session_save_point') + version;
    session[DB_SESSION_PRE_UPGRADE_KEY] = version;
    await addToSavedSessions(session);
    log('gsIndexedDb', 'Created automatic session restore point');
  }
  const newSessionRestorePoint = await fetchSessionRestorePoint(version);
  log('gsIndexedDb', 'New session restore point:', newSessionRestorePoint);
  return newSessionRestorePoint || null;
};

export const fetchSessionRestorePoint = async versionValue => {
  let results;
  try {
    const gsDb = await getDb();
    const tableName = DB_SAVED_SESSIONS;
    results = await gsDb
      .query(tableName)
      .filter(DB_SESSION_PRE_UPGRADE_KEY, versionValue)
      .distinct()
      .execute();
  } catch (e) {
    error('gsIndexedDb', e);
  }
  if (results && results.length > 0) {
    return results[0];
  }
  return null;
};

// Returns most recent session in DB_CURRENT_SESSIONS EXCLUDING the current session
export const fetchLastSession = async () => {
  let results;
  try {
    const gsDb = await getDb();
    results = await gsDb
      .query(DB_CURRENT_SESSIONS, 'id')
      .all()
      .desc()
      .execute();
  } catch (e) {
    error('gsIndexedDb', e);
  }
  if (results && results.length > 0) {
    //don't want to match on current session
    const currentSessionId = getSessionId();
    const lastSession = results.find(o => o.sessionId !== currentSessionId);
    return lastSession;
  }
  return null;
};

export const fetchSavedSessions = async () => {
  let results;
  try {
    const gsDb = await getDb();
    results = await gsDb
      .query(DB_SAVED_SESSIONS)
      .all()
      .execute();
  } catch (e) {
    error('gsIndexedDb', e);
    results = [];
  }
  return results;
};

export const addToSavedSessions = async session => {
  //if sessionId does not already have an underscore prefix then generate a new unique sessionId for this saved session
  if (session.sessionId.indexOf('_') < 0) {
    session.sessionId = '_' + generateHashCode(session.name);
  }

  //clear id as it will be either readded (if sessionId match found) or generated (if creating a new session)
  delete session.id;
  await updateSession(session);
};

// For testing only!
export const initTestDatabase = async () => {
  DB_SERVER = 'tgsTest';
  server = null;
  try {
    const gsDb = await getDb();
    await gsDb.clear(DB_CURRENT_SESSIONS);
    await gsDb.clear(DB_SAVED_SESSIONS);
  } catch (e) {
    error('gsIndexedDb', e);
  }
};

export const removeTabFromSessionHistory = async (
  sessionId,
  windowId,
  tabId
) => {
  const gsSession = await fetchSessionBySessionId(sessionId);
  gsSession.windows.some(function(curWindow, windowIndex) {
    const matched = curWindow.tabs.some(function(curTab, tabIndex) {
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
    await updateSession(gsSession);
    //or remove session if it no longer contains any windows
  } else {
    await removeSessionFromHistory(sessionId);
  }
  const updatedSession = await fetchSessionBySessionId(sessionId);
  return updatedSession;
};

export const removeSessionFromHistory = async sessionId => {
  const tableName =
    sessionId.indexOf('_') === 0 ? DB_SAVED_SESSIONS : DB_CURRENT_SESSIONS;

  try {
    const gsDb = await getDb();
    const result = await gsDb
      .query(tableName)
      .filter('sessionId', sessionId)
      .execute();
    if (result.length > 0) {
      const session = result[0];
      await gsDb.remove(tableName, session.id);
    }
  } catch (e) {
    error('gsIndexedDb', e);
  }
};

export const trimDbItems = async () => {
  const maxTabItems = 1000;
  const maxHistories = 5;

  try {
    const gsDb = await getDb();

    //trim suspendedTabInfo. if there are more than maxTabItems items, then remove the oldest ones
    const suspendedTabInfos = await gsDb
      .query(DB_SUSPENDED_TABINFO, 'id')
      .all()
      .keys()
      .execute();
    if (suspendedTabInfos.length > maxTabItems) {
      const itemsToRemove = suspendedTabInfos.length - maxTabItems;
      for (let i = 0; i < itemsToRemove; i++) {
        await gsDb.remove(DB_SUSPENDED_TABINFO, suspendedTabInfos[i]);
      }
    }

    //trim suspendedTabInfo. if there are more than maxTabItems items, then remove the oldest ones
    const faviconMetas = await gsDb
      .query(DB_FAVICON_META, 'id')
      .all()
      .keys()
      .execute();
    //when favicons are stored they also create an extra indexedDb item with the root url as the key
    //so they will have slightly more entries than the suspendedTabInfos
    const maxFaviconItems = parseInt(maxTabItems + maxTabItems * 0.3);
    if (faviconMetas.length > maxFaviconItems) {
      const itemsToRemove = faviconMetas.length - maxFaviconItems;
      for (let i = 0; i < itemsToRemove; i++) {
        await gsDb.remove(DB_FAVICON_META, faviconMetas[i]);
      }
    }

    //trim imagePreviews. if there are more than maxTabItems items, then remove the oldest ones
    const previews = await gsDb
      .query(DB_PREVIEWS, 'id')
      .all()
      .keys()
      .execute();
    if (previews.length > maxTabItems) {
      const itemsToRemove = previews.length - maxTabItems;
      for (let i = 0; i < itemsToRemove; i++) {
        await gsDb.remove(DB_PREVIEWS, previews[i]);
      }
    }

    //trim currentSessions. if there are more than maxHistories items, then remove the oldest ones
    const currentSessions = await gsDb
      .query(DB_CURRENT_SESSIONS, 'id')
      .all()
      .keys()
      .execute();

    if (currentSessions.length > maxHistories) {
      const itemsToRemove = currentSessions.length - maxHistories;
      for (let i = 0; i < itemsToRemove; i++) {
        await gsDb.remove(DB_CURRENT_SESSIONS, currentSessions[i]);
      }
    }
  } catch (e) {
    error('gsIndexedDb', e);
  }
};

/**
 * MIGRATIONS
 */

export const performMigration = async oldVersion => {
  try {
    const gsDb = await getDb();
    const extensionName = chrome.runtime.getManifest().name || '';

    const major = parseInt(oldVersion.split('.')[0] || 0);
    const minor = parseInt(oldVersion.split('.')[1] || 0);
    const testMode = extensionName.includes('Test');
    // patch = parseInt(oldVersion.split('.')[2] || 0);

    //perform migrated history fixup
    if (major < 6 || (major === 6 && minor < 13)) {
      // if (oldVersion < 6.13)

      //fix up migrated saved session and newly saved session sessionIds
      const savedSessions = await gsDb
        .query(DB_SAVED_SESSIONS)
        .all()
        .execute();
      for (const session of savedSessions) {
        if (session.id === 7777) {
          session.sessionId = '_7777';
          session.name = 'Recovered tabs';
          session.date = new Date(session.date).toISOString();
        } else {
          session.sessionId = '_' + generateHashCode(session.name);
        }
        await gsDb.update(DB_SAVED_SESSIONS, session);
      }
    }
    if (major < 6 || (major === 6 && minor < 30)) {
      // if (oldVersion < 6.30)

      if (getOption('preview')) {
        if (getOption('previewQuality') === '0.1') {
          setOption(SCREEN_CAPTURE, '1');
        } else {
          setOption(SCREEN_CAPTURE, '2');
        }
      } else {
        setOption(SCREEN_CAPTURE, '0');
      }
    }
    if (major < 6 || (major === 6 && minor < 31) || testMode) {
      // if (oldVersion < 6.31)
      const cookies = await cookiesGetAll();
      const scrollPosByTabId = {};
      for (const cookie of cookies) {
        if (cookie.name.indexOf('gsScrollPos') === 0) {
          if (cookie.value && cookie.value !== '0') {
            const tabId = cookie.name.substr(12);
            scrollPosByTabId[tabId] = cookie.value;
          }
          let prefix = cookie.secure ? 'https://' : 'http://';
          if (cookie.domain.charAt(0) === '.') {
            prefix += 'www';
          }
          const url = prefix + cookie.domain + cookie.path;
          await cookiesRemove(url, cookie.name);
        }
      }
    }
  } catch (e) {
    error('gsIndexedDb', e);
  }
};
