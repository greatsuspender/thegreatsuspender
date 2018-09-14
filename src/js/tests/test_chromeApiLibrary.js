/*global chrome, gsUtils, assertTrue */
var testSuites = typeof testSuites === 'undefined' ? [] : testSuites;
testSuites.push(
  (function() {
    'use strict';

    async function removeTestTab(tabId, retainFocus) {
      const currentTab = await new Promise(r => chrome.tabs.getCurrent(r));
      await new Promise(r => chrome.tabs.remove(tabId, r));
      if (retainFocus) {
        await new Promise(r =>
          chrome.tabs.update(currentTab.id, { active: true }, r)
        );
      }
    }
    async function removeTestWindow(windowId, retainFocus) {
      const currentWindow = await new Promise(r =>
        chrome.windows.getCurrent(r)
      );
      await new Promise(r => chrome.windows.remove(windowId, r));
      if (retainFocus) {
        await new Promise(r =>
          chrome.windows.update(currentWindow.id, { focused: true }, r)
        );
      }
    }

    const testTabUrl = 'http://rabbits.com/';

    const tests = [
      // Test gsUtils.setTimeout
      async () => {
        const timeout = 500;
        const timeBefore = new Date().getTime();
        await gsUtils.setTimeout(timeout);
        const timeAfter = new Date().getTime();
        const isTimeAfterValid =
          timeAfter > timeBefore + timeout &&
          timeAfter < timeBefore + timeout + 200;

        return assertTrue(isTimeAfterValid);
      },

      // Test gsUtils.chromeCookiesGetAll and gsUtils.chromeCookiesRemove
      async () => {
        const cookieUrl = 'http://rabbits.com/';
        const cookieName = 'gsTest';
        const cookieValue = 'rabbitts';

        await new Promise(r =>
          chrome.cookies.remove({ url: cookieUrl, name: cookieName }, r)
        );
        const cookieAtStart = await new Promise(r =>
          chrome.cookies.get({ url: cookieUrl, name: cookieName }, r)
        );
        const isCookieAtStartValid = cookieAtStart === null;

        await new Promise(r =>
          chrome.cookies.set(
            { url: cookieUrl, name: cookieName, value: cookieValue },
            r
          )
        );
        const cookieBefore = await new Promise(r =>
          chrome.cookies.get({ url: cookieUrl, name: cookieName }, r)
        );
        const isCookieBeforeValid = cookieBefore.value === cookieValue;

        const cookiesBefore = await gsUtils.chromeCookiesGetAll();
        const isCookiePresentInGetAll = cookiesBefore.some(
          o => o.value.indexOf(cookieValue) === 0
        );

        await gsUtils.chromeCookiesRemove(cookieUrl, cookieName);
        const cookiesAfter = await gsUtils.chromeCookiesGetAll();
        const isCookieRemovedFromGetAll = cookiesAfter.every(
          o => o.value.indexOf(cookieValue) !== 0
        );

        return assertTrue(
          isCookieAtStartValid &&
            isCookieBeforeValid &&
            isCookiePresentInGetAll &&
            isCookieRemovedFromGetAll
        );
      },

      // Test gsUtils.chromeTabsCreate
      async () => {
        // stub gsUtils.error function
        let errorObj;
        gsUtils.error = (id, _errorObj, ...args) => {
          errorObj = _errorObj;
        };

        const newTab1 = await gsUtils.chromeTabsCreate();
        const isNewTab1Valid =
          newTab1 === null && errorObj === 'url not specified';

        const newTab2 = await gsUtils.chromeTabsCreate(testTabUrl);
        const isNewTab2Valid = newTab2.url === testTabUrl;

        // cleanup
        await removeTestTab(newTab2.id, true);

        return assertTrue(isNewTab1Valid && isNewTab2Valid);
      },

      // Test gsUtils.chromeTabsUpdate
      async () => {
        // stub gsUtils.error function
        let errorObj;
        gsUtils.error = (id, _errorObj, ...args) => {
          errorObj = _errorObj;
        };

        // create a test tab to update
        const testTab1 = await new Promise(r =>
          chrome.tabs.create({ url: testTabUrl, active: false }, r)
        );
        const isTestTab1Valid = testTab1.url === testTabUrl;

        const updateTab1 = await gsUtils.chromeTabsUpdate();
        const isUpdateTab1Valid =
          updateTab1 === null &&
          errorObj === 'tabId or updateProperties not specified';

        const updateTab2 = await gsUtils.chromeTabsUpdate(testTab1.id);
        const isUpdateTab2Valid =
          updateTab2 === null &&
          errorObj === 'tabId or updateProperties not specified';

        const updateTab3 = await gsUtils.chromeTabsUpdate(7777, {});
        const isUpdateTab3Valid =
          updateTab3 === null && errorObj.message === 'No tab with id: 7777.';

        const isUpdateTab4BeforeValid = testTab1.pinned === false;
        const updateTab4 = await gsUtils.chromeTabsUpdate(testTab1.id, {
          pinned: true,
        });
        const isUpdateTab4AfterValid = updateTab4.pinned === true;

        // cleanup
        await removeTestTab(testTab1.id, false);

        return assertTrue(
          isTestTab1Valid &&
            isUpdateTab1Valid &&
            isUpdateTab2Valid &&
            isUpdateTab3Valid &&
            isUpdateTab4BeforeValid &&
            isUpdateTab4AfterValid
        );
      },

      // Test gsUtils.chromeTabsGet
      async () => {
        // stub gsUtils.error function
        let errorObj;
        gsUtils.error = (id, _errorObj, ...args) => {
          errorObj = _errorObj;
        };

        // create a test tab
        const testTab1 = await new Promise(r =>
          chrome.tabs.create({ url: testTabUrl, active: false }, r)
        );
        const isTestTab1Valid = testTab1.url === testTabUrl;

        const tab1 = await gsUtils.chromeTabsGet();
        const isTab1Valid = tab1 === null && errorObj === 'tabId not specified';

        const tab2 = await gsUtils.chromeTabsGet(7777);
        const isTab2Valid =
          tab2 === null && errorObj.message === 'No tab with id: 7777.';

        const tab3 = await gsUtils.chromeTabsGet(testTab1.id);
        const isTab3Valid = tab3.url === testTabUrl;

        // cleanup
        await removeTestTab(testTab1.id, false);

        return assertTrue(
          isTestTab1Valid && isTab1Valid && isTab2Valid && isTab3Valid
        );
      },

      // Test gsUtils.chromeTabsQuery
      async () => {
        const tabsBefore = await gsUtils.chromeTabsQuery();

        // create a test tab
        const testTab1 = await new Promise(r =>
          chrome.tabs.create({ url: testTabUrl, active: false }, r)
        );
        const isTestTab1Valid = testTab1.url === testTabUrl;

        const tabsAfter = await gsUtils.chromeTabsQuery();
        const areTabsAfterValid = tabsAfter.length === tabsBefore.length + 1;

        // cleanup
        await removeTestTab(testTab1.id, false);

        return assertTrue(isTestTab1Valid && areTabsAfterValid);
      },

      // Test gsUtils.chromeWindowsGetAll
      async () => {
        const windowsBefore = await gsUtils.chromeWindowsGetAll();

        // create a test window
        const testWindow1 = await new Promise(r =>
          chrome.windows.create({ focused: false }, r)
        );
        const isTestWindow1Valid = testWindow1.tabs.length === 1;

        const windowsAfter = await gsUtils.chromeWindowsGetAll();
        const areWindowsAfterValid =
          windowsAfter.length === windowsBefore.length + 1 &&
          windowsAfter[1].tabs[0].title === 'New Tab';

        // cleanup
        await removeTestWindow(testWindow1.id, false);

        return assertTrue(isTestWindow1Valid && areWindowsAfterValid);
      },

      // Test gsUtils.chromeWindowsUpdate
      async () => {
        // stub gsUtils.error function
        let errorObj;
        gsUtils.error = (id, _errorObj, ...args) => {
          errorObj = _errorObj;
        };

        // create a test window to update
        const testWindow1 = await new Promise(r =>
          chrome.windows.create({ focused: false }, r)
        );
        const isTestWindow1Valid = testWindow1.tabs.length === 1;

        const updateWindow1 = await gsUtils.chromeWindowsUpdate();
        const isUpdateWindow1Valid =
          updateWindow1 === null &&
          errorObj === 'windowId or updateInfo not specified';

        const updateWindow2 = await gsUtils.chromeWindowsUpdate(testWindow1.id);
        const isUpdateWindow2Valid =
          updateWindow2 === null &&
          errorObj === 'windowId or updateInfo not specified';

        const updateWindow3 = await gsUtils.chromeWindowsUpdate(7777, {});
        const isUpdateWindow3Valid =
          updateWindow3 === null &&
          errorObj.message === 'No window with id: 7777.';

        const testWidth = 500;
        const isUpdateWindow4BeforeValid = testWindow1.width !== testWidth;
        const updateWindow4 = await gsUtils.chromeWindowsUpdate(
          testWindow1.id,
          {
            width: testWidth,
          }
        );
        const isUpdateWindow4AfterValid = updateWindow4.width === testWidth;

        // cleanup
        await removeTestWindow(testWindow1.id, false);

        return assertTrue(
          isTestWindow1Valid &&
            isUpdateWindow1Valid &&
            isUpdateWindow2Valid &&
            isUpdateWindow3Valid &&
            isUpdateWindow4BeforeValid &&
            isUpdateWindow4AfterValid
        );
      },
    ];

    return {
      name: 'Chrome API Library',
      tests,
    };
  })()
);
