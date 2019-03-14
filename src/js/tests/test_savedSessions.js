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

        const session1 = await getFixture(
          FIXTURE_SAVED_SESSIONS,
          'savedSession1'
        );
        await gsIndexedDb.updateSession(session1);
        const dbSavedSession1 = await gsIndexedDb.fetchSessionBySessionId(
          session1.sessionId
        );
        const isSessionValid =
          dbSavedSession1.id === session1.id &&
          dbSavedSession1.sessionId === session1.sessionId &&
          dbSavedSession1.sessionId.indexOf('_') === 0 &&
          dbSavedSession1.windows.length === 1 &&
          dbSavedSession1.windows[0].tabs.length === 5 &&
          dbSavedSession1.windows[0].tabs[0].id === 3630;

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
        const session1 = await getFixture(
          FIXTURE_SAVED_SESSIONS,
          'savedSession1'
        );
        await gsIndexedDb.updateSession(session1);
        const savedSessionsBefore = await gsIndexedDb.fetchSavedSessions();
        const isSavedSessionsBeforeValid = savedSessionsBefore.length === 1;

        await gsIndexedDb.removeSessionFromHistory(
          savedSessionsBefore[0].sessionId
        );

        const savedSessionsAfter = await gsIndexedDb.fetchSavedSessions();
        const isSavedSessionsAfterValid = savedSessionsAfter.length === 0;

        return assertTrue(
          isSavedSessionsBeforeValid && isSavedSessionsAfterValid
        );
      },

      // Test saving a lot of large sessions
      // async () => {
      //   const largeSessionTemplate = getFixture(FIXTURE_SAVED_SESSIONS, 'savedSession1');
      //   delete largeSessionTemplate.id;
      //   const tabsTemplate = JSON.parse(
      //     JSON.stringify(largeSessionTemplate.windows[0].tabs)
      //   );
      //   for (let i = 0; i < 500; i++) {
      //     largeSessionTemplate.windows[0].tabs = largeSessionTemplate.windows[0].tabs.concat(
      //       JSON.parse(JSON.stringify(tabsTemplate))
      //     );
      //   }
      //   for (let j = 0; j < 50; j++) {
      //     const largeSession = JSON.parse(JSON.stringify(largeSessionTemplate));
      //     largeSession.sessionId = '_' + j;
      //     const dbSession = await gsStorage.updateSession(largeSession);
      //   }
      //
      //   const savedSessionsAfter = await gsStorage.fetchSavedSessions();
      //   const isSavedSessionsPopulated = savedSessionsAfter.length === 101;
      //
      //   return assertTrue(
      //       isSavedSessionsPopulated
      //   );
      // },
    ];

    return {
      name: 'Saved Sessions',
      tests,
    };
  })()
);
