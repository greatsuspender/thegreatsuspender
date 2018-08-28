/*global gsStorage, testSuite0,  */
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

// eslint-disable-next-line no-unused-vars
function assertTrue(testResult) {
  if (testResult) {
    return Promise.resolve(true);
  } else {
    return Promise.reject(new Error(Error.captureStackTrace({})));
  }
}

async function runTests() {
  for (let [i, testSuite] of testSuites.entries()) {
    // loads/reset required libs
    await Promise.all(testSuite.requiredLibs.map(loadJsFile));
    // if testSuite requires gsStorage, then clear indexedDb contents
    if (gsStorage) {
      gsStorage.DB_SERVER = 'tgsTest';
      await gsStorage.clearGsDatabase();
    }

    let allTestsPassed = true;
    console.log(`Running testSuite ${i}..`);
    for (let [j, test] of testSuite.tests.entries()) {
      console.log(`  Running test ${j}..`);
      // reset fixtures before each test
      await Promise.all(
        testSuite.requiredFixtures.map(async fixtureName => {
          fixtures[fixtureName] = await loadJsonFixture(fixtureName);
        })
      );
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
    const resultEl = document.createElement('div');
    if (allTestsPassed) {
      resultEl.innerHTML = `TestSuite ${i}: PASSED.`;
      resultEl.style = 'color: green;';
    } else {
      resultEl.innerHTML = `TestSuite ${i}: FAILED.`;
      resultEl.style = 'color: red;';
    }
    document.getElementById('results').appendChild(resultEl);
  }
  document.getElementById('inProgress').classList.add('reallyHidden');
  document.getElementById('completed').classList.remove('reallyHidden');
}

const testSuites = [testSuite0];
const fixtures = {};

runTests();
