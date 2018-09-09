/*global chrome, gsIndexedDb, getFixture, assertTrue, FIXTURE_SAVED_SESSIONS */
var testSuites = typeof testSuites === 'undefined' ? [] : testSuites;
testSuites.push(
  (function() {
    'use strict';

    const tests = [
      // Test saving new savedSession
      async () => {
        const currentSessionsBefore = await gsIndexedDb.fetchCurrentSessions();
        const wasCurrentSessionsEmpty = currentSessionsBefore.length === 0;
        const savedSessionsBefore = await gsIndexedDb.fetchSavedSessions();
        const wasSavedSessionsEmpty = savedSessionsBefore.length === 0;

        const session1 = await getFixture(FIXTURE_SAVED_SESSIONS, 'savedSession1');
        const dbSession = await gsIndexedDb.updateSession(session1);
        const isSessionValid =
          dbSession.id === session1.id &&
          dbSession.sessionId === session1.sessionId &&
          dbSession.sessionId.indexOf('_') === 0 &&
          dbSession.windows.length === 1 &&
          dbSession.windows[0].tabs.length === 5 &&
          dbSession.windows[0].tabs[0].id === 3630;

        const currentSessionsAfter = await gsIndexedDb.fetchCurrentSessions();
        const isCurrentSessionsEmpty = currentSessionsAfter.length === 0;

        const savedSessionsAfter = await gsIndexedDb.fetchSavedSessions();
        const isSavedSessionsPopulated = savedSessionsAfter.length === 1;

        return assertTrue(
          wasCurrentSessionsEmpty &&
          wasSavedSessionsEmpty &&
          isCurrentSessionsEmpty &&
          isSavedSessionsPopulated &&
          isSessionValid
        );
      },

      // Test removing savedSession
      async () => {
        const session1 = await getFixture(FIXTURE_SAVED_SESSIONS, 'savedSession1');
        await gsIndexedDb.updateSession(session1);
        const savedSessionsBefore = await gsIndexedDb.fetchSavedSessions();
        const isSavedSessionsBeforeValid = savedSessionsBefore.length === 1;

        await gsIndexedDb.removeSessionFromHistory(savedSessionsBefore[0].sessionId);

        const savedSessionsAfter = await gsIndexedDb.fetchSavedSessions();
        const isSavedSessionsAfterValid = savedSessionsAfter.length === 0;

        return assertTrue(
          isSavedSessionsBeforeValid &&
          isSavedSessionsAfterValid
        );
      },

    ];

    return {
      name: 'Saved Sessions',
      tests,
    };
  })()
);
