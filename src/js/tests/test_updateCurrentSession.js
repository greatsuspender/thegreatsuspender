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

        for (let i = 0; i < 1000; i++) {
            let windowTemplate = JSON.parse(
              JSON.stringify(fixtures.currentSessions.currentSession1.windows[0])
          );
          windowTemplate.id = i;
          currentSessionWindows.push(windowTemplate);

          //TODO: This should probably return a promise
          // await new Promise(resolve =>
          //   gsUtils.saveWindowsToSessionHistory(currentSessionId, currentSessionWindows)
          // );
          gsUtils.saveWindowsToSessionHistory(
            currentSessionId,
            currentSessionWindows
          );
          // For now, add a timeout
          await new Promise(r => setTimeout(r, 1));
        }

        const currentSessionsAfter = await gsStorage.fetchCurrentSessions();
        const isCurrentSessionsPopulated = currentSessionsAfter.length === 1;
        const isCurrentSessionValid =
          currentSessionsAfter[0].windows.length === 100;
        console.log(currentSessionsAfter.length);
        console.log(currentSessionsAfter[0].windows.length);

        return assertTrue(isCurrentSessionsPopulated && isCurrentSessionValid);
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
