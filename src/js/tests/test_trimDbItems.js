/*global chrome, gsStorage, gsSession, fixtures, assertTrue */
var testSuites = typeof testSuites === 'undefined' ? [] : testSuites;
testSuites.push(
  (function() {
    'use strict';

    const tests = [
      // Test trim currentSessions
      async () => {
        await gsStorage.clearGsDatabase();

        // Simulate adding 10 older sessions in DB_CURRENT_SESSIONS
        for (let i = 10; i > 0; i--) {
          let sessionTemplate = JSON.parse(
            JSON.stringify(fixtures.currentSessions.currentSession1)
          );
          delete sessionTemplate.id;
          sessionTemplate.sessionId = i + '';
          const previousDateInMs = Date.now() - 1000 * 60 * 60 * i;
          sessionTemplate.date = new Date(previousDateInMs).toISOString();
          await new Promise(resolve =>
            gsStorage.updateSession(sessionTemplate, resolve)
          );
        }

        // Add a current session
        const currentSessionId = gsSession.getSessionId();
        let sessionTemplate = JSON.parse(
          JSON.stringify(fixtures.currentSessions.currentSession1)
        );
        delete sessionTemplate.id;
        sessionTemplate.sessionId = currentSessionId;
        sessionTemplate.date = new Date().toISOString();
        await new Promise(resolve =>
          gsStorage.updateSession(sessionTemplate, resolve)
        );

        const currentSessionsBefore = await gsStorage.fetchCurrentSessions();
        const areCurrentSessionsBeforeValid =
          currentSessionsBefore.length === 11;

        const lastSessionBefore = await gsStorage.fetchLastSession();
        const isLastSessionBeforeValid = lastSessionBefore.sessionId === '1';

        await gsStorage.trimDbItems();

        //TODO: Fix bug where the above does not wait for actual trim to finish
        await new Promise(r => setTimeout(r, 50));

        // Ensure current session still exists
        const currentSession = await gsStorage.fetchSessionBySessionId(
          currentSessionId
        );
        const isCurrentSessionValid = currentSession !== null;

        // Ensure correct DB_CURRENT_SESSIONS items were trimmed
        const currentSessionsAfter = await gsStorage.fetchCurrentSessions();
        const areCurrentSessionsAfterValid = currentSessionsAfter.length === 5;

        // Ensure fetchLastSession returns correct session
        const lastSessionAfter = await gsStorage.fetchLastSession();
        const isLastSessionAfterValid = lastSessionAfter.sessionId === '1';

        return assertTrue(
          areCurrentSessionsBeforeValid &&
            isLastSessionBeforeValid &&
            isCurrentSessionValid &&
            areCurrentSessionsAfterValid &&
            isLastSessionAfterValid
        );
      },
    ];

    return {
      name: 'Trim Db Items',
      requiredLibs: ['db', 'gsStorage', 'gsSession', 'gsUtils'],
      requiredFixtures: ['currentSessions'],
      tests,
    };
  })()
);
