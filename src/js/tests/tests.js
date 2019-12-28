import { initTestDatabase } from '../gsIndexedDb';

import testCreateAndUpdateSessionRestorePoint from './test_createAndUpdateSessionRestorePoint';
import testCurrentSessions from './test_currentSessions';
import testGsChrome from './test_gsChrome';
import testGsTabQueue from './test_gsTabQueue';
import testGsUtils from './test_gsUtils';
import testSavedSessions from './test_savedSessions';
import testSuspendTab from './test_suspendTab';
import testTrimDbItems from './test_trimDbItems';
import testUpdateCurrentSession from './test_updateCurrentSession';

import fixtureCurrentSessions from './fixture_currentSessions';
import fixtureSavedSessions from './fixture_savedSessions';
import fixturePreviewUrls from './fixture_previewUrls';

export const FIXTURE_CURRENT_SESSIONS = 'currentSessions';
export const FIXTURE_SAVED_SESSIONS = 'savedSessions';
export const FIXTURE_PREVIEW_URLS = 'previewUrls';

const fixtures = {
  [FIXTURE_CURRENT_SESSIONS]: { ...fixtureCurrentSessions },
  [FIXTURE_SAVED_SESSIONS]: { ...fixtureSavedSessions },
  [FIXTURE_PREVIEW_URLS]: { ...fixturePreviewUrls },
};

const testSuites = [
  testCreateAndUpdateSessionRestorePoint,
  testCurrentSessions,
  // testGsChrome,
  testGsTabQueue,
  testGsUtils,
  testSavedSessions,
  testSuspendTab,
  testTrimDbItems,
  testUpdateCurrentSession,
];

export function assertTrue(testResult) {
  if (testResult) {
    return Promise.resolve(true);
  } else {
    return Promise.reject(new Error(Error.captureStackTrace({})));
  }
}

export async function getFixture(fixtureName, itemName) {
  return JSON.parse(JSON.stringify(fixtures[fixtureName][itemName]));
}

async function runTests() {
  for (const testSuite of testSuites) {
    const resultEl = document.createElement('div');
    resultEl.innerHTML = `Testing ${testSuite.name}...`;
    document.getElementById('results').appendChild(resultEl);

    let allTestsPassed = true;
    console.log(`Running testSuite: ${testSuite.name}..`);
    for (const [j, test] of testSuite.tests.entries()) {
      console.log(`  Running test ${j + 1}..`);

      // clear indexedDb contents
      await initTestDatabase();

      // run test
      try {
        const result = await test();
        console.log(`  ${result}`);
        allTestsPassed = allTestsPassed && result;
      } catch (e) {
        allTestsPassed = false;
        console.error(e);
      }
    }

    //update test.html with testSuite result
    if (allTestsPassed) {
      resultEl.innerHTML = `Testing ${testSuite.name}: PASSED`;
      resultEl.style = 'color: green;';
    } else {
      resultEl.innerHTML = `Testing ${testSuite.name}: FAILED`;
      resultEl.style = 'color: red;';
    }
  }
  document.getElementById('suspendy-guy-inprogress').style.display = 'none';
  document.getElementById('suspendy-guy-complete').style.display =
    'inline-block';
}

if (document.readyState !== 'loading') {
  runTests();
} else {
  document.addEventListener('DOMContentLoaded', function() {
    runTests();
  });
}
