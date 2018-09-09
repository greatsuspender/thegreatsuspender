/*global chrome, gsIndexedDb, getFixture, assertTrue, FIXTURE_CURRENT_SESSIONS */
var testSuites = typeof testSuites === 'undefined' ? [] : testSuites;
testSuites.push(
  (function() {
    'use strict';

    const tests = [
      // Test saving new currentSession
      async () => {
        const currentSessionsBefore = await gsIndexedDb.fetchCurrentSessions();
        const wasCurrentSessionsEmpty = currentSessionsBefore.length === 0;

        const session1 = await getFixture(FIXTURE_CURRENT_SESSIONS, 'currentSession1');
        const dbSession = await gsIndexedDb.updateSession(session1);

        const isSessionValid =
          dbSession.id === session1.id &&
          dbSession.sessionId === session1.sessionId &&
          dbSession.windows.length === 1 &&
          dbSession.windows[0].tabs.length === 5 &&
          dbSession.windows[0].tabs[0].id === 3630;

        const currentSessionsAfter = await gsIndexedDb.fetchCurrentSessions();
        const isCurrentSessionsPopulated = currentSessionsAfter.length === 1;

        return assertTrue(
          wasCurrentSessionsEmpty &&
            isCurrentSessionsPopulated &&
            isSessionValid
        );
      },

      // Test updating existing currentSession
      async () => {
        const session1 = await getFixture(FIXTURE_CURRENT_SESSIONS, 'currentSession1');
        const dbSession1 = await gsIndexedDb.updateSession(session1);
        const oldId = dbSession1.id;
        const oldSessionDate = dbSession1.date;
        dbSession1.windows[0].tabs.push({
          id: 7777,
          title: 'testTab',
          url: 'https://test.com',
        });

        const dbSession2 = await gsIndexedDb.updateSession(dbSession1);
        const isSessionValid =
          dbSession2.sessionId === dbSession1.sessionId &&
          dbSession2.windows.length === 1 &&
          dbSession2.windows[0].tabs.length === 6 &&
          dbSession2.windows[0].tabs[5].id === 7777 &&
          oldId === dbSession2.id &&
          oldSessionDate < dbSession2.date;

        const currentSessionsAfter = await gsIndexedDb.fetchCurrentSessions();
        const isCurrentSessionsPopulated = currentSessionsAfter.length === 1;

        return assertTrue(isCurrentSessionsPopulated && isSessionValid);
      },
    ];

    return {
      name: 'Current Sessions',
      tests,
    };
  })()
);
