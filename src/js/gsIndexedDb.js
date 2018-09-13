/*global chrome, db, tgs, gsUtils, gsSession */
'use strict';

var gsIndexedDb = {
  DB_SERVER: 'tgs',
  DB_VERSION: '2',
  DB_PREVIEWS: 'gsPreviews',
  DB_SUSPENDED_TABINFO: 'gsSuspendedTabInfo',
  DB_CURRENT_SESSIONS: 'gsCurrentSessions',
  DB_SAVED_SESSIONS: 'gsSavedSessions',
  DB_SESSION_PRE_UPGRADE_KEY: 'preUpgradeVersion',

  server: null,

  getDb: async function() {
    if (!this.server) {
      this.server = await db.open({
        server: this.DB_SERVER,
        version: this.DB_VERSION,
        schema: this.getSchema,
      });
    }
    return this.server;
  },

  getSchema: function() {
    // NOTE: Called directly from db.js so 'this' cannot be relied upon
    return {
      [gsIndexedDb.DB_PREVIEWS]: {
        key: {
          keyPath: 'id',
          autoIncrement: true,
        },
        indexes: {
          id: {},
          url: {},
        },
      },
      [gsIndexedDb.DB_SUSPENDED_TABINFO]: {
        key: {
          keyPath: 'id',
          autoIncrement: true,
        },
        indexes: {
          id: {},
          url: {},
        },
      },
      [gsIndexedDb.DB_CURRENT_SESSIONS]: {
        key: {
          keyPath: 'id',
          autoIncrement: true,
        },
        indexes: {
          id: {},
          sessionId: {},
        },
      },
      [gsIndexedDb.DB_SAVED_SESSIONS]: {
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

  fetchPreviewImage: async function(tabUrl) {
    let results;
    try {
      const gsDb = await this.getDb();
      results = await gsDb
        .query(this.DB_PREVIEWS, 'url')
        .only(tabUrl)
        .execute();
    } catch (e) {
      gsUtils.error('gsIndexedDb', e);
    }
    if (results && results.length > 0) {
      return results[0];
    }
    return null;
  },

  addPreviewImage: async function(tabUrl, previewUrl) {
    try {
      const gsDb = await this.getDb();
      const results = await gsDb
        .query(this.DB_PREVIEWS, 'url')
        .only(tabUrl)
        .execute();
      if (results.length > 0) {
        for (const result of results) {
          await gsDb.remove(this.DB_PREVIEWS, result.id);
        }
      }
      await gsDb.add(this.DB_PREVIEWS, { url: tabUrl, img: previewUrl });
    } catch (e) {
      gsUtils.error('gsIndexedDb', e);
    }
  },

  addSuspendedTabInfo: async function(tabProperties) {
    try {
      if (!tabProperties.url) {
        gsUtils.error('gsIndexedDb', 'tabProperties.url not set.');
        return;
      }
      const gsDb = await this.getDb();
      const results = await gsDb
        .query(this.DB_SUSPENDED_TABINFO)
        .filter('url', tabProperties.url)
        .execute();
      if (results.length > 0) {
        for (const result of results) {
          await gsDb.remove(this.DB_SUSPENDED_TABINFO, result.id);
        }
      }
      await gsDb.add(this.DB_SUSPENDED_TABINFO, tabProperties);
    } catch (e) {
      gsUtils.error('gsIndexedDb', e);
    }
  },

  fetchTabInfo: async function(tabUrl) {
    let results;
    try {
      const gsDb = await this.getDb();
      results = await gsDb
        .query(this.DB_SUSPENDED_TABINFO, 'url')
        .only(tabUrl)
        .distinct()
        .desc()
        .execute();
    } catch (e) {
      gsUtils.error('gsIndexedDb', e);
    }
    if (results && results.length > 0) {
      return results[0];
    }
    return null;
  },

  updateSession: async function(session) {
    try {
      const gsDb = await this.getDb();

      //if it's a saved session (prefixed with an underscore)
      var tableName =
        session.sessionId.indexOf('_') === 0
          ? this.DB_SAVED_SESSIONS
          : this.DB_CURRENT_SESSIONS;

      //first check to see if session id already exists
      const matchingSession = await this.fetchSessionBySessionId(
        session.sessionId
      );
      if (matchingSession) {
        session.id = matchingSession.id; //copy across id from matching session
        session.date = new Date().toISOString();
        await gsDb.update(tableName, session); //then update based on that id
      } else {
        await gsDb.add(tableName, session);
      }
    } catch (e) {
      gsUtils.error('gsIndexedDb', e);
    }
  },

  fetchCurrentSessions: async function() {
    let results;
    try {
      const gsDb = await this.getDb();
      results = await gsDb
        .query(this.DB_CURRENT_SESSIONS)
        .all()
        .desc()
        .execute();
    } catch (e) {
      gsUtils.error('gsIndexedDb', e);
    }
    return results;
  },

  fetchSessionBySessionId: async function(sessionId) {
    let results;
    try {
      const gsDb = await this.getDb();

      //if it's a saved session (prefixed with an underscore)
      const tableName =
        sessionId.indexOf('_') === 0
          ? this.DB_SAVED_SESSIONS
          : this.DB_CURRENT_SESSIONS;
      results = await gsDb
        .query(tableName, 'sessionId')
        .only(sessionId)
        .desc()
        .execute();

      if (results.length > 1) {
        gsUtils.log(
          'gsIndexedDb',
          'Duplicate sessions found for sessionId: ' +
            sessionId +
            '! Removing older ones..'
        );
        for (var session of results.slice(1)) {
          await gsDb.remove(tableName, session.id);
        }
      }
    } catch (e) {
      gsUtils.error('gsIndexedDb', e);
    }
    if (results && results.length > 0) {
      return results[0];
    }
    return null;
  },

  createOrUpdateSessionRestorePoint: async function(session, version) {
    const existingSessionRestorePoint = await this.fetchSessionRestorePoint(version);
    if (existingSessionRestorePoint) {
      existingSessionRestorePoint.windows = session.windows;
      await this.updateSession(existingSessionRestorePoint);
      gsUtils.log(
        'gsIndexedDb',
        'Updated automatic session restore point'
      );
    } else {
      session.name = 'Automatic save point for v' + version;
      session[gsIndexedDb.DB_SESSION_PRE_UPGRADE_KEY] = version;
      await this.addToSavedSessions(session);
      gsUtils.log(
        'gsIndexedDb',
        'Created automatic session restore point'
      );
    }
    const newSessionRestorePoint = await this.fetchSessionRestorePoint(version);
    gsUtils.log(
      'gsIndexedDb',
      'New session restore point:',
      newSessionRestorePoint
    );
    return newSessionRestorePoint;
  },

  fetchSessionRestorePoint: async function(versionValue) {
    let results;
    try {
      const gsDb = await this.getDb();
      var tableName = this.DB_SAVED_SESSIONS;
      results = await gsDb
        .query(tableName)
        .filter(this.DB_SESSION_PRE_UPGRADE_KEY, versionValue)
        .distinct()
        .execute();
    } catch (e) {
      gsUtils.error('gsIndexedDb', e);
    }
    if (results && results.length > 0) {
      return results[0];
    }
    return null;
  },

  // Returns most recent session in DB_CURRENT_SESSIONS EXCLUDING the current session
  fetchLastSession: async function() {
    let results;
    try {
      const gsDb = await this.getDb();
      results = await gsDb
        .query(this.DB_CURRENT_SESSIONS, 'id')
        .all()
        .desc()
        .execute();
    } catch (e) {
      gsUtils.error('gsIndexedDb', e);
    }
    if (results && results.length > 0) {
      //don't want to match on current session
      const currentSessionId = gsSession.getSessionId();
      const lastSession = results.find(o => o.sessionId !== currentSessionId);
      return lastSession;
    }
    return null;
  },

  fetchSavedSessions: async function() {
    let results;
    try {
      const gsDb = await this.getDb();
      results = await gsDb
        .query(this.DB_SAVED_SESSIONS)
        .all()
        .execute();
    } catch (e) {
      gsUtils.error('gsIndexedDb', e);
    }
    return results;
  },

  addToSavedSessions: async function(session) {
    //if sessionId does not already have an underscore prefix then generate a new unique sessionId for this saved session
    if (session.sessionId.indexOf('_') < 0) {
      session.sessionId = '_' + gsUtils.generateHashCode(session.name);
    }

    //clear id as it will be either readded (if sessionId match found) or generated (if creating a new session)
    delete session.id;
    await this.updateSession(session);
  },

  clearGsDatabase: async function() {
    try {
      const gsDb = await this.getDb();
      await gsDb.clear(this.DB_CURRENT_SESSIONS);
      await gsDb.clear(this.DB_SAVED_SESSIONS);
    } catch (e) {
      gsUtils.error('gsIndexedDb', e);
    }
  },

  removeTabFromSessionHistory: async function(sessionId, windowId, tabId) {
    const gsSession = await this.fetchSessionBySessionId(sessionId);
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
      await this.updateSession(gsSession);
      //or remove session if it no longer contains any windows
    } else {
      await this.removeSessionFromHistory(sessionId);
    }
    const updatedSession = await this.fetchSessionBySessionId(sessionId);;
    return updatedSession;
  },

  removeSessionFromHistory: async function(sessionId) {
    const tableName =
      sessionId.indexOf('_') === 0
        ? this.DB_SAVED_SESSIONS
        : this.DB_CURRENT_SESSIONS;

    try {
      const gsDb = await this.getDb();
      const result = await gsDb
        .query(tableName)
        .filter('sessionId', sessionId)
        .execute();
      if (result.length > 0) {
        const session = result[0];
        await gsDb.remove(tableName, session.id);
      }
    } catch (e) {
      gsUtils.error('gsIndexedDb', e);
    }
  },

  trimDbItems: async function() {
    const maxTabItems = 1000;
    const maxHistories = 5;

    try {
      const gsDb = await this.getDb();

      //trim suspendedTabInfo. if there are more than maxTabItems items, then remove the oldest ones
      const suspendedTabInfos = await gsDb
        .query(this.DB_SUSPENDED_TABINFO, 'id')
        .all()
        .keys()
        .execute();
      if (suspendedTabInfos.length > maxTabItems) {
        const itemsToRemove = suspendedTabInfos.length - maxTabItems;
        for (let i = 0; i < itemsToRemove; i++) {
          await gsDb.remove(this.DB_SUSPENDED_TABINFO, suspendedTabInfos[i]);
        }
      }

      //trim imagePreviews. if there are more than maxTabItems items, then remove the oldest ones
      const previews = await gsDb
        .query(this.DB_PREVIEWS, 'id')
        .all()
        .keys()
        .execute();
      if (previews.length > maxTabItems) {
        const itemsToRemove = previews.length - maxTabItems;
        for (let i = 0; i < itemsToRemove; i++) {
          await gsDb.remove(this.DB_PREVIEWS, previews[i]);
        }
      }

      //trim currentSessions. if there are more than maxHistories items, then remove the oldest ones
      const currentSessions = await gsDb
        .query(this.DB_CURRENT_SESSIONS, 'id')
        .all()
        .keys()
        .execute();

      if (currentSessions.length > maxHistories) {
        const itemsToRemove = currentSessions.length - maxHistories;
        for (let i = 0; i < itemsToRemove; i++) {
          await gsDb.remove(this.DB_CURRENT_SESSIONS, currentSessions[i]);
        }
      }
    } catch (e) {
      gsUtils.error('gsIndexedDb', e);
    }
  },

  /**
   * MIGRATIONS
   */

  performMigration: async function(oldVersion) {
    try {
      const gsDb = await this.getDb();
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
          .query(this.DB_SAVED_SESSIONS)
          .all()
          .execute();
        for (const session of savedSessions) {
          if (session.id === 7777) {
            session.sessionId = '_7777';
            session.name = 'Recovered tabs';
            session.date = new Date(session.date).toISOString();
          } else {
            session.sessionId = '_' + gsUtils.generateHashCode(session.name);
          }
          await gsDb.update(this.DB_SAVED_SESSIONS, session);
        }
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
        const cookies = await new Promise(r => chrome.cookies.getAll({}, r));
        var scrollPosByTabId = {};
        for (const cookie of cookies) {
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
            await new Promise(r =>
              chrome.cookies.remove({ url: url, name: cookie.name }, r)
            );
          }
        }
        tgs.scrollPosByTabId = scrollPosByTabId;
      }
    } catch (e) {
      gsUtils.error('gsIndexedDb', e);
    }
  },
};
