/* global gsIndexedDb, testSuites */
/* eslint-disable no-unused-vars */

const FIXTURE_CURRENT_SESSIONS = 'currentSessions';
const FIXTURE_SAVED_SESSIONS = 'savedSessions';
const FIXTURE_PREVIEW_URLS = 'previewUrls';

const requiredLibs = [
  'db',
  'gsSession',
  'gsStorage',
  'gsUtils',
  'gsChrome',
  'gsTabSuspendManager',
  'gsIndexedDb',
  'gsTabQueue',
  'gsFavicon',
];

function loadJsFile(fileName) {
  return new Promise(resolve => {
    const script = document.createElement('script');
    script.onload = resolve;
    script.src = chrome.extension.getURL(`js/${fileName}.js`);
    document.head.appendChild(script);
  });
}

function loadJsonFixture(fileName) {
  return new Promise(resolve => {
    const request = new XMLHttpRequest();
    request.open(
      'GET',
      chrome.extension.getURL(`js/tests/fixture_${fileName}.json`),
      true
    );
    request.onload = () => {
      return resolve(JSON.parse(request.responseText));
    };
    request.send();
  });
}

function assertTrue(testResult) {
  if (testResult) {
    return Promise.resolve(true);
  } else {
    return Promise.reject(new Error(Error.captureStackTrace({})));
  }
}

async function getFixture(fixtureName, itemName) {
  const fixtures = await loadJsonFixture(fixtureName);
  return JSON.parse(JSON.stringify(fixtures[itemName]));
}

async function runTests() {
  for (let testSuite of testSuites) {
    const resultEl = document.createElement('div');
    resultEl.innerHTML = `Testing ${testSuite.name}...`;
    document.getElementById('results').appendChild(resultEl);

    let allTestsPassed = true;
    console.log(`Running testSuite: ${testSuite.name}..`);
    for (let [j, test] of testSuite.tests.entries()) {
      console.log(`  Running test ${j + 1}..`);

      // loads/reset required libs
      await Promise.all(requiredLibs.map(loadJsFile));

      // clear indexedDb contents
      gsIndexedDb.DB_SERVER = 'tgsTest';
      await gsIndexedDb.clearGsDatabase();

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
