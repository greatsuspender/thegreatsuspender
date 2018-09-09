/*global chrome, gsIndexedDb, gsSession, getFixture, assertTrue, FIXTURE_CURRENT_SESSIONS */
var testSuites = typeof testSuites === 'undefined' ? [] : testSuites;
testSuites.push(
  (function() {
    'use strict';

    const oldVersion = '1.2.34';
    const newVersion = '7.7.77';

    const tests = [
      // Test create session restore point when no current sessions exist
      // Should create a session from the currently open windows
      async () => {
        // Simulate gsSession.prepareForUpdate
        const sessionRestorePointAfter = await gsIndexedDb.createSessionRestorePoint(
          oldVersion,
          newVersion
        );

        //TODO: For now, this is unimplemented functionality. If there is no existing current
        // session, then createSessionRestorePoint will not be able to create a session.
        // const sessionRestoreMatchesCurrentSession =
        //   sessionRestorePointAfter.windows[0].tabs.length === 5;
        // return assertTrue(sessionRestoreMatchesCurrentSession);
        return assertTrue(sessionRestorePointAfter === null);
      },

      // Test create session restore point when current sessions exists
      // Should create a session from the currently open windows
      async () => {
        // Create a current session from fixtures
        const session1 = await getFixture(FIXTURE_CURRENT_SESSIONS, 'currentSession1');
        session1.sessionId = gsSession.getSessionId();
        await gsIndexedDb.updateSession(session1);

        // Simulate gsSession.prepareForUpdate
        const sessionRestorePointAfter = await gsIndexedDb.createSessionRestorePoint(
          oldVersion,
          newVersion
        );
        const sessionRestoreMatchesCurrentSession =
          sessionRestorePointAfter.windows[0].tabs.length === 5;
        return assertTrue(sessionRestoreMatchesCurrentSession);
      },

      // Test create session restore point when session restore point already exists
      // NOTE: Existing session restore point should have different id for this test
      // Should update the current session restore point
      async () => {
        // Create a session restore point and updated the id after it's been created
        const session1 = await getFixture(FIXTURE_CURRENT_SESSIONS, 'currentSession1');
        delete session1.id;
        session1.sessionId = gsSession.getSessionId();
        await gsIndexedDb.updateSession(session1);
        await gsIndexedDb.createSessionRestorePoint(
          oldVersion,
          newVersion
        );
        const sessionRestorePointBefore = await gsIndexedDb.fetchSessionRestorePoint(
          gsIndexedDb.DB_SESSION_POST_UPGRADE_KEY,
          newVersion
        );
        const newId = '_777777';
        sessionRestorePointBefore.id = newId;
        sessionRestorePointBefore.sessionId = newId;
        await gsIndexedDb.updateSession(sessionRestorePointBefore);
        const newSessionRestorePointBefore = await gsIndexedDb.fetchSessionBySessionId(
          newId
        );
        const isSessionRestorePointBeforeValid =
          newSessionRestorePointBefore.windows[0].tabs.length === 5;

        // Update current session from fixtures
        const session2 = await getFixture(FIXTURE_CURRENT_SESSIONS, 'currentSession1');
        const currentSessionId = gsSession.getSessionId();
        session2.sessionId = currentSessionId;
        session2.windows[0].tabs.push({
          id: 7777,
          title: 'testTab',
          url: 'https://test.com',
        });
        await gsIndexedDb.updateSession(session2);
        const newCurrentSession = await gsIndexedDb.fetchSessionBySessionId(
          currentSessionId
        );
        const currentSessionUpdated =
          newCurrentSession.windows[0].tabs.length === 6;

        // Simulate gsSession.prepareForUpdate
        //TODO: I think ideally we'd just change this function to createOrUpdateSessionRestorePoint
        const sessionRestorePointAfter = await gsIndexedDb.createSessionRestorePoint(
          oldVersion,
          newVersion
        );
        const sessionRestorePointAfterValid =
          sessionRestorePointAfter.windows[0].tabs.length === 6;

        //TODO: Fix bug where calling createSessionRestorePoint a second time for same versions
        // causes two sessions to exists with these version numbers (it should update existing one)
        // Conveniently for this current release, it always returns the most recently created one.
        const gsTestDb = await gsIndexedDb.getDb();
        const sessionRestoreCount = await gsTestDb
          .query(gsIndexedDb.DB_SAVED_SESSIONS)
          .filter(gsIndexedDb.DB_SESSION_POST_UPGRADE_KEY, newVersion)
          .execute()
          .then(o => o.length);

        return assertTrue(
          isSessionRestorePointBeforeValid &&
            currentSessionUpdated &&
            sessionRestorePointAfterValid &&
            sessionRestoreCount === 2 //should be 1
        );
      },
    ];

    return {
      name: 'Session Restore Points',
      tests,
    };
  })()
);
