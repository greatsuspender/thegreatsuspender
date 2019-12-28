import { getFixture, assertTrue, FIXTURE_CURRENT_SESSIONS } from './tests.js';
import * as gsIndexedDb from '../gsIndexedDb';
import * as gsSession from '../gsSession';

export default (function() {
  const tests = [
    // Test trim currentSessions
    async () => {
      const currentSessionId = gsSession.getSessionId();
      // Simulate adding 10 older sessions in DB_CURRENT_SESSIONS
      for (let i = 10; i > 0; i--) {
        const oldSession = await getFixture(
          FIXTURE_CURRENT_SESSIONS,
          'currentSession1'
        );
        delete oldSession.id;
        oldSession.sessionId = i + '';
        const previousDateInMs = Date.now() - 1000 * 60 * 60 * i;
        oldSession.date = new Date(previousDateInMs).toISOString();
        await gsIndexedDb.updateSession(oldSession);
      }

      // Add a current session
      const session1 = await getFixture(
        FIXTURE_CURRENT_SESSIONS,
        'currentSession1'
      );
      const currentSession1 = await gsSession.buildCurrentSession();
      currentSession1.windows = session1.windows;
      await gsIndexedDb.updateSession(currentSession1);

      const currentSessionsBefore = await gsIndexedDb.fetchCurrentSessions();
      const areCurrentSessionsBeforeValid = currentSessionsBefore.length === 11;

      const lastSessionBefore = await gsIndexedDb.fetchLastSession();
      const isLastSessionBeforeValid = lastSessionBefore.sessionId === '1';

      await gsIndexedDb.trimDbItems();

      // Ensure current session still exists
      const currentSession = await gsIndexedDb.fetchSessionBySessionId(
        currentSessionId
      );
      const isCurrentSessionValid = currentSession !== null;

      // Ensure correct DB_CURRENT_SESSIONS items were trimmed
      const currentSessionsAfter = await gsIndexedDb.fetchCurrentSessions();
      const areCurrentSessionsAfterValid = currentSessionsAfter.length === 5;

      // Ensure fetchLastSession returns correct session
      const lastSessionAfter = await gsIndexedDb.fetchLastSession();
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
    tests,
  };
})();
