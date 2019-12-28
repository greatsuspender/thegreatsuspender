import { getFixture, assertTrue, FIXTURE_CURRENT_SESSIONS } from './tests.js';
import * as gsIndexedDb from '../gsIndexedDb';
import * as gsSession from '../gsSession';
import * as gsUtils from '../gsUtils';

export default (function() {
  const tests = [
    // Test hammering current session with updates
    async () => {
      const currentSessionWindows = [];
      const currentSessionId = gsSession.getSessionId();

      for (let i = 0; i < 100; i++) {
        const session1 = await getFixture(
          FIXTURE_CURRENT_SESSIONS,
          'currentSession1'
        );
        const windowTemplate = session1.windows[0];
        windowTemplate.id = i;
        currentSessionWindows.push(windowTemplate);

        const currentSession = await gsSession.buildCurrentSession();
        currentSession.windows = currentSessionWindows;

        // Purposely don't await on this call
        gsIndexedDb.updateSession(currentSession);
        await gsUtils.setTimeout(1);
      }

      //if it's a saved session (prefixed with an underscore)
      const gsTestDb = await gsIndexedDb.getDb();
      const results = await gsTestDb
        .query(gsIndexedDb.DB_CURRENT_SESSIONS, 'sessionId')
        .only(currentSessionId)
        .desc()
        .execute();
      const onlySingleSessionForIdExists = results.length === 1;

      const currentSessionsAfter = await gsIndexedDb.fetchCurrentSessions();
      const isCurrentSessionsPopulated = currentSessionsAfter.length === 1;
      const isCurrentSessionValid =
        currentSessionsAfter[0].windows.length === 100;

      return assertTrue(
        onlySingleSessionForIdExists &&
          isCurrentSessionsPopulated &&
          isCurrentSessionValid
      );
    },
  ];

  return {
    name: 'Update current session',
    tests,
  };
})();
