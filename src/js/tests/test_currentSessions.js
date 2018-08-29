/*global chrome, gsStorage, fixtures, assertTrue */
var testSuites = typeof testSuites === 'undefined' ? [] : testSuites;
testSuites.push(
  (function() {
    'use strict';

    const tests = [
      // Test saving new currentSession
      async () => {
        const currentSessionsBefore = await gsStorage.fetchCurrentSessions();
        const wasCurrentSessionsEmpty = currentSessionsBefore.length === 0;

        const session1 = fixtures.currentSessions.currentSession1;
        const dbSession = await new Promise(resolve =>
          gsStorage.updateSession(session1, resolve)
        );

        const isSessionValid =
          dbSession.id === session1.id &&
          dbSession.sessionId === session1.sessionId &&
          dbSession.windows.length === 1 &&
          dbSession.windows[0].tabs.length === 5 &&
          dbSession.windows[0].tabs[0].id === 3630;

        const currentSessionsAfter = await gsStorage.fetchCurrentSessions();
        const isCurrentSessionsPopulated = currentSessionsAfter.length === 1;

        return assertTrue(
          wasCurrentSessionsEmpty &&
            isCurrentSessionsPopulated &&
            isSessionValid
        );
      },

      // Test updating existing currentSession
      async () => {
        const currentSessionsBefore = await gsStorage.fetchCurrentSessions();
        const session1 = currentSessionsBefore[0];
        const oldId = session1.id;
        const oldSessionDate = session1.date;
        session1.windows[0].tabs.push({
          id: 7777,
          title: 'testTab',
          url: 'https://test.com',
        });

        const dbSession = await new Promise(resolve =>
          gsStorage.updateSession(session1, resolve)
        );
        const isSessionValid =
          dbSession.sessionId === session1.sessionId &&
          dbSession.windows.length === 1 &&
          dbSession.windows[0].tabs.length === 6 &&
          dbSession.windows[0].tabs[5].id === 7777 &&
          oldId === dbSession.id &&
          oldSessionDate < dbSession.date;

        const currentSessionsAfter = await gsStorage.fetchCurrentSessions();
        const isCurrentSessionsPopulated = currentSessionsAfter.length === 1;

        return assertTrue(isCurrentSessionsPopulated && isSessionValid);
      },
    ];

    return {
      name: 'Current Sessions',
      requiredLibs: ['db', 'gsStorage', 'gsSession'],
      requiredFixtures: ['currentSessions'],
      tests,
    };
  })()
);
