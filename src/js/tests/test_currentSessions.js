/*global chrome, gsIndexedDb, gsSession, getFixture, assertTrue, FIXTURE_CURRENT_SESSIONS */
var testSuites = typeof testSuites === 'undefined' ? [] : testSuites;
testSuites.push(
  (function() {
    'use strict';

    const tests = [
      // Test saving new currentSession
      async () => {
        const currentSessionId = gsSession.getSessionId();
        const currentSessionsBefore = await gsIndexedDb.fetchCurrentSessions();
        const wasCurrentSessionsEmpty = currentSessionsBefore.length === 0;

        // Simulate gsSession.updateCurrentSession()
        const session1 = await getFixture(
          FIXTURE_CURRENT_SESSIONS,
          'currentSession1'
        );
        const currentSession = await gsSession.buildCurrentSession();
        currentSession.windows = session1.windows;
        await gsIndexedDb.updateSession(currentSession);
        const savedCurrentSession = await gsIndexedDb.fetchSessionBySessionId(
          currentSessionId
        );

        const isSessionValid =
          savedCurrentSession.sessionId === currentSessionId &&
          savedCurrentSession.windows.length === 1 &&
          savedCurrentSession.windows[0].tabs.length === 5 &&
          savedCurrentSession.windows[0].tabs[0].id === 3630;

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
        const currentSessionId = gsSession.getSessionId();
        const session1 = await getFixture(
          FIXTURE_CURRENT_SESSIONS,
          'currentSession1'
        );
        const currentSession1 = await gsSession.buildCurrentSession();
        currentSession1.windows = session1.windows;
        await gsIndexedDb.updateSession(currentSession1);
        const dbCurrentSession1 = await gsIndexedDb.fetchSessionBySessionId(
          currentSessionId
        );
        const isSession1Valid =
          dbCurrentSession1.sessionId === currentSessionId &&
          dbCurrentSession1.windows[0].tabs.length === 5;

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
        await gsIndexedDb.updateSession(currentSession2);

        const dbCurrentSession2 = await gsIndexedDb.fetchSessionBySessionId(
          currentSessionId
        );
        const isSession2Valid =
          dbCurrentSession2.sessionId === currentSessionId &&
          dbCurrentSession2.windows.length === 1 &&
          dbCurrentSession2.windows[0].tabs.length === 6 &&
          dbCurrentSession2.windows[0].tabs[5].id === 7777 &&
          dbCurrentSession1.id === dbCurrentSession2.id &&
          dbCurrentSession1.date < dbCurrentSession2.date;

        const currentSessionsAfter = await gsIndexedDb.fetchCurrentSessions();
        const isCurrentSessionsAfterValid = currentSessionsAfter.length === 1;

        return assertTrue(
          isSession1Valid && isSession2Valid && isCurrentSessionsAfterValid
        );
      },
    ];

    return {
      name: 'Current Sessions',
      tests,
    };
  })()
);
