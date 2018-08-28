/*global chrome, gsStorage, fixtures, assertTrue */
// eslint-disable-next-line no-unused-vars
let testSuite0 = (function() {
  'use strict';

  const tests = [
    // Test saving new currentSession
    async () => {
      const currentSessionsBefore = await gsStorage.fetchCurrentSessions();
      const wasCurrentSessionsEmpty = currentSessionsBefore.length === 0;

      const session1 = fixtures.sessions.currentSession1;
      const savedSession = await new Promise(resolve =>
        gsStorage.updateSession(session1, resolve)
      );

      const isSessionValid =
        savedSession.id === session1.id &&
        savedSession.sessionId === session1.sessionId &&
        savedSession.windows.length === 1 &&
        savedSession.windows[0].tabs.length === 1 &&
        savedSession.windows[0].tabs[0].id === 7777;

      const currentSessionsAfter = await gsStorage.fetchCurrentSessions();
      const isCurrentSessionsPopulated = currentSessionsAfter.length === 1;

      return assertTrue(
        wasCurrentSessionsEmpty && isCurrentSessionsPopulated && isSessionValid
      );
    },

    // Test updating existing currentSession
    async () => {
      const currentSessionsBefore = await gsStorage.fetchCurrentSessions();
      const session1 = currentSessionsBefore[0];
      const oldId = session1.id;
      const oldSessionDate = session1.date;
      session1.windows[0].tabs.push({
        id: 7778,
        title: 'testTab2',
        url: 'https://tested.com',
      });

      const savedSession = await new Promise(resolve =>
        gsStorage.updateSession(session1, resolve)
      );
      const isSessionValid =
        savedSession.sessionId === session1.sessionId &&
        savedSession.windows.length === 1 &&
        savedSession.windows[0].tabs.length === 2 &&
        savedSession.windows[0].tabs[1].id === 7778 &&
        oldId === savedSession.id &&
        oldSessionDate < savedSession.date;

      const currentSessionsAfter = await gsStorage.fetchCurrentSessions();
      const isCurrentSessionsPopulated = currentSessionsAfter.length === 1;

      return assertTrue(isCurrentSessionsPopulated && isSessionValid);
    },

    // Test saving new savedSession
    async () => {
      const savedSessionsBefore = await gsStorage.fetchSavedSessions();
      const wasSavedSessionsEmpty = savedSessionsBefore.length === 0;

      const session1 = fixtures.sessions.currentSession1;
      session1.sessionId = '_' + session1;
      const savedSession = await new Promise(resolve =>
        gsStorage.updateSession(session1, resolve)
      );
      const isSessionValid =
        savedSession.id === session1.id &&
        savedSession.sessionId === session1.sessionId &&
        savedSession.sessionId.indexOf('_') === 0 &&
        savedSession.windows.length === 1 &&
        savedSession.windows[0].tabs.length === 1 &&
        savedSession.windows[0].tabs[0].id === 7777;

      const savedSessionsAfter = await gsStorage.fetchSavedSessions();
      const isSavedSessionsPopulated = savedSessionsAfter.length === 1;

      return assertTrue(
        wasSavedSessionsEmpty && isSavedSessionsPopulated && isSessionValid
      );
    },
  ];

  return {
    requiredLibs: ['db', 'gsStorage', 'gsSession'],
    requiredFixtures: ['sessions'],
    tests,
  };
})();
