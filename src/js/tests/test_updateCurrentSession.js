/*global chrome, gsSession, gsStorage, gsUtils, fixtures, assertTrue */
var testSuites = typeof testSuites === 'undefined' ? [] : testSuites;
testSuites.push(
  (function() {
    'use strict';

    const tests = [
      // Test hammering current session with updates
      async () => {
        const currentSessionWindows = [];
        const currentSessionId = gsSession.getSessionId();

        for (let i = 0; i < 100; i++) {
            let windowTemplate = JSON.parse(
              JSON.stringify(fixtures.currentSessions.currentSession1.windows[0])
          );
          windowTemplate.id = i;
          currentSessionWindows.push(windowTemplate);

          // Purposely don't await on this call
          gsUtils.saveWindowsToSessionHistory(currentSessionId, currentSessionWindows);
          await new Promise(r => setTimeout(r, 1));
        }

        //if it's a saved session (prefixed with an underscore)
        const gsTestDb = await gsStorage.getDb();
        const results = await gsTestDb
          .query(gsStorage.DB_CURRENT_SESSIONS, 'sessionId')
          .only(currentSessionId)
          .desc()
          .execute();
        const onlySingleSessionForIdExists = results.length === 1;

        const currentSessionsAfter = await gsStorage.fetchCurrentSessions();
        const isCurrentSessionsPopulated = currentSessionsAfter.length === 1;
        const isCurrentSessionValid =
          currentSessionsAfter[0].windows.length === 100;

        return assertTrue(onlySingleSessionForIdExists && isCurrentSessionsPopulated && isCurrentSessionValid);
      },
    ];

    return {
      name: 'Update current session',
      requiredLibs: ['db', 'gsSession', 'gsStorage', 'gsUtils'],
      requiredFixtures: ['currentSessions'],
      tests,
    };
  })()
);
