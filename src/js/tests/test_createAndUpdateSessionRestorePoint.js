/*global chrome, gsIndexedDb, gsSession, getFixture, loadJsFile, assertTrue, FIXTURE_CURRENT_SESSIONS */
var testSuites = typeof testSuites === 'undefined' ? [] : testSuites;
testSuites.push(
  (function() {
    'use strict';

    const oldVersion = '1.2.34';

    const tests = [
      // Test create session restore point. Should create a session from the currently open windows
      async () => {
        // Simulate gsSession.prepareForUpdate
        const session1 = await getFixture(
          FIXTURE_CURRENT_SESSIONS,
          'currentSession1'
        );
        const currentSession = await gsSession.buildCurrentSession();
        currentSession.windows = session1.windows;
        const sessionRestorePointAfter = await gsIndexedDb.createOrUpdateSessionRestorePoint(
          currentSession,
          oldVersion
        );
        const isSessionRestorePointValid =
          sessionRestorePointAfter.windows[0].tabs.length === 5;
        return assertTrue(isSessionRestorePointValid);
      },

      // Test create session restore point when session restore point already exists from same session
      async () => {
        // Create a session restore point
        const session1 = await getFixture(
          FIXTURE_CURRENT_SESSIONS,
          'currentSession1'
        );
        const currentSession1 = await gsSession.buildCurrentSession();
        currentSession1.windows = session1.windows;
        await gsIndexedDb.createOrUpdateSessionRestorePoint(
          currentSession1,
          oldVersion
        );
        const newSessionRestorePointBefore = await gsIndexedDb.fetchSessionBySessionId(
          currentSession1.sessionId
        );
        const isSessionRestorePointBeforeValid =
          newSessionRestorePointBefore.windows[0].tabs.length === 5;

        const session2 = await getFixture(
          FIXTURE_CURRENT_SESSIONS,
          'currentSession1'
        );
        const currentSession2 = await gsSession.buildCurrentSession();
        currentSession2.windows = session2.windows;
        currentSession2.windows[0].tabs.push({
          id: 7777,
          title: 'testTab',
          url: 'https://test.com',
        });
        const sessionRestorePointAfter = await gsIndexedDb.createOrUpdateSessionRestorePoint(
          currentSession2,
          oldVersion
        );
        const sessionRestorePointAfterValid =
          sessionRestorePointAfter.windows[0].tabs.length === 6;

        const gsTestDb = await gsIndexedDb.getDb();
        const sessionRestoreCount = await gsTestDb
          .query(gsIndexedDb.DB_SAVED_SESSIONS)
          .filter(gsIndexedDb.DB_SESSION_PRE_UPGRADE_KEY, oldVersion)
          .execute()
          .then(o => o.length);

        return assertTrue(
          isSessionRestorePointBeforeValid &&
            sessionRestorePointAfterValid &&
            sessionRestoreCount === 1
        );
      },

      // Test create session restore point when session restore point already exists from another session
      async () => {
        // Create a session restore point (uses current session based on gsSession.getSessionId)
        const session1 = await getFixture(
          FIXTURE_CURRENT_SESSIONS,
          'currentSession1'
        );
        const currentSession1 = await gsSession.buildCurrentSession();
        currentSession1.windows = session1.windows;
        const oldCurrentSessionId = currentSession1.sessionId;
        const sessionRestorePointBefore = await gsIndexedDb.createOrUpdateSessionRestorePoint(
          currentSession1,
          oldVersion
        );
        const isSessionRestorePointBeforeValid =
          sessionRestorePointBefore.windows[0].tabs.length === 5;

        // Simulate an extension restart by resetting gsSession sessionId and saving a new 'current session'
        await loadJsFile('gsSession');
        const session2 = await getFixture(
          FIXTURE_CURRENT_SESSIONS,
          'currentSession1'
        );
        const currentSession2 = await gsSession.buildCurrentSession();
        const newCurrentSessionId = currentSession2.sessionId;
        const isCurrentSessionIdChanged =
          oldCurrentSessionId !== newCurrentSessionId;

        currentSession2.windows = session2.windows;
        currentSession2.windows[0].tabs.push({
          id: 7777,
          title: 'testTab',
          url: 'https://test.com',
        });
        const sessionRestorePointAfter = await gsIndexedDb.createOrUpdateSessionRestorePoint(
          currentSession2,
          oldVersion
        );
        const sessionRestorePointAfterValid =
          sessionRestorePointAfter.windows[0].tabs.length === 6;

        const gsTestDb = await gsIndexedDb.getDb();
        const sessionRestoreCount = await gsTestDb
          .query(gsIndexedDb.DB_SAVED_SESSIONS)
          .filter(gsIndexedDb.DB_SESSION_PRE_UPGRADE_KEY, oldVersion)
          .execute()
          .then(o => o.length);

        return assertTrue(
          isSessionRestorePointBeforeValid &&
            isCurrentSessionIdChanged &&
            sessionRestorePointAfterValid &&
            sessionRestoreCount === 1
        );
      },
    ];

    return {
      name: 'Session Restore Points',
      tests,
    };
  })()
);
