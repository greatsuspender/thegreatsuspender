/*global chrome, gsUtils, gsChrome, assertTrue */
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
        chrome.windows.getLastFocused(r)
      );
      await new Promise(r => chrome.windows.remove(windowId, r));
      await new Promise(resolve =>
        chrome.windows.get(windowId, async window => {
          if (chrome.runtime.lastError) {
            // do nothing. window removed successfully
          } else {
            // if no error thrown, then window still exists. wait 100ms (hax0r)
            await gsUtils.setTimeout(100);
          }
          resolve();
        })
      );
      if (retainFocus) {
        await new Promise(r =>
          chrome.windows.update(currentWindow.id, { focused: true }, r)
        );
      }
    }

    const testTabUrl = 'http://rabbits.com/';

    const tests = [
      // Test gsChrome.cookiesGetAll and gsChrome.cookiesRemove
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

        const cookiesBefore = await gsChrome.cookiesGetAll();
        const isCookiePresentInGetAll = cookiesBefore.some(
          o => o.value.indexOf(cookieValue) === 0
        );

        await gsChrome.cookiesRemove(cookieUrl, cookieName);
        const cookiesAfter = await gsChrome.cookiesGetAll();
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

      // Test gsChrome.tabsCreate
      async () => {
        // stub gsUtils.warning function
        let warningString;
        gsUtils.warning = (id, _warningString, ...args) => {
          warningString = _warningString;
        };

        const newTab1 = await gsChrome.tabsCreate();
        const isNewTab1Valid =
          newTab1 === null && warningString === 'url not specified';

        const newTab2 = await gsChrome.tabsCreate(testTabUrl);
        const isNewTab2Valid = newTab2.url === testTabUrl;

        // cleanup
        await removeTestTab(newTab2.id, true);

        return assertTrue(isNewTab1Valid && isNewTab2Valid);
      },

      // Test gsChrome.tabsReload
      async () => {
        // stub gsUtils.warning function
        let warningString;
        gsUtils.warning = (id, _warningString, ...args) => {
          warningString = _warningString;
        };

        // create a test tab
        const testTab1 = await new Promise(r =>
          chrome.tabs.create({ url: testTabUrl, active: false }, r)
        );
        const isTestTab1Valid = testTab1.url === testTabUrl;

        const result1 = await gsChrome.tabsReload();
        const isTabReload1Valid =
          warningString === 'tabId not specified' && result1 === false;

        const result2 = await gsChrome.tabsReload(7777);
        const isTabReload2Valid =
          warningString.message === 'No tab with id: 7777.' &&
          result2 === false;

        warningString = null;
        const result3 = await gsChrome.tabsReload(testTab1.id);
        const isTabReload3Valid = warningString === null && result3 === true;

        // cleanup
        await removeTestTab(testTab1.id, true);

        return assertTrue(
          isTestTab1Valid &&
            isTabReload1Valid &&
            isTabReload2Valid &&
            isTabReload3Valid
        );
      },

      // Test gsChrome.tabsUpdate
      async () => {
        // stub gsUtils.warning function
        let warningString;
        gsUtils.warning = (id, _warningString, ...args) => {
          warningString = _warningString;
        };

        // create a test tab to update
        const testTab1 = await new Promise(r =>
          chrome.tabs.create({ url: testTabUrl, active: false }, r)
        );
        const isTestTab1Valid = testTab1.url === testTabUrl;

        const updateTab1 = await gsChrome.tabsUpdate();
        const isUpdateTab1Valid =
          updateTab1 === null &&
          warningString === 'tabId or updateProperties not specified';

        const updateTab2 = await gsChrome.tabsUpdate(testTab1.id);
        const isUpdateTab2Valid =
          updateTab2 === null &&
          warningString === 'tabId or updateProperties not specified';

        const updateTab3 = await gsChrome.tabsUpdate(7777, {});
        const isUpdateTab3Valid =
          updateTab3 === null &&
          warningString.message === 'No tab with id: 7777.';

        const isUpdateTab4BeforeValid = testTab1.pinned === false;
        const updateTab4 = await gsChrome.tabsUpdate(testTab1.id, {
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

      // Test gsChrome.tabsGet
      async () => {
        // stub gsUtils.warning function
        let warningString;
        gsUtils.warning = (id, _warningString, ...args) => {
          warningString = _warningString;
        };
        gsUtils.warning = (id, _warningString, ...args) => {
          warningString = _warningString;
        };

        // create a test tab
        const testTab1 = await new Promise(r =>
          chrome.tabs.create({ url: testTabUrl, active: false }, r)
        );
        const isTestTab1Valid = testTab1.url === testTabUrl;

        const tab1 = await gsChrome.tabsGet();
        const isTab1Valid =
          tab1 === null && warningString === 'tabId not specified';

        const tab2 = await gsChrome.tabsGet(7777);
        const isTab2Valid =
          tab2 === null && warningString.message === 'No tab with id: 7777.';

        const tab3 = await gsChrome.tabsGet(testTab1.id);
        const isTab3Valid = tab3.url === testTabUrl;

        // cleanup
        await removeTestTab(testTab1.id, false);

        return assertTrue(
          isTestTab1Valid && isTab1Valid && isTab2Valid && isTab3Valid
        );
      },

      // Test gsChrome.tabsQuery
      async () => {
        //TODO: Add handing of bad property values to all gsChrome tests
        // const errorTabs = await gsChrome.tabsQuery({badProperty: 'foo'});
        // const isErrorTabsValid = errorTabs === null && warningString === 'tabId not specified';

        // stub gsUtils.warning function
        // let warningString;
        // gsUtils.warning = (id, _warningString, ...args) => {
        //   warningString = _warningString;
        // };

        const tabsBefore = await gsChrome.tabsQuery();

        // create a test tab
        const testTab1 = await new Promise(r =>
          chrome.tabs.create({ url: testTabUrl, active: false }, r)
        );
        const isTestTab1Valid = testTab1.url === testTabUrl;

        const tabsAfter = await gsChrome.tabsQuery();
        const areTabsAfterValid = tabsAfter.length === tabsBefore.length + 1;

        // cleanup
        await removeTestTab(testTab1.id, false);

        // return assertTrue(isErrorTabsValid && isTestTab1Valid && areTabsAfterValid);
        return assertTrue(isTestTab1Valid && areTabsAfterValid);
      },

      // Test gsChrome.tabsRemove
      async () => {
        // stub gsUtils.warning function
        let warningString;
        gsUtils.warning = (id, _warningString, ...args) => {
          warningString = _warningString;
        };

        // create a test tab
        const testTab1 = await new Promise(r =>
          chrome.tabs.create({ url: testTabUrl, active: false }, r)
        );
        const isTestTab1Valid = testTab1.url === testTabUrl;

        await gsChrome.tabsRemove();
        const isTabRemove1Valid = warningString === 'tabId not specified';

        await gsChrome.tabsRemove(7777);
        const isTabRemove2Valid =
          warningString.message === 'No tab with id: 7777.';

        await gsChrome.tabsRemove(testTab1.id);

        const testTab1Removed = await gsChrome.tabsGet(testTab1.id);
        const isTabRemove3Valid = testTab1Removed === null;

        return assertTrue(
          isTestTab1Valid &&
            isTabRemove1Valid &&
            isTabRemove2Valid &&
            isTabRemove3Valid
        );
      },

      // Test gsChrome.windowsCreate
      async () => {
        const windowsBefore = await new Promise(r =>
          chrome.windows.getAll({ populate: true }, r)
        );

        // create a test window
        const testWindow1 = await gsChrome.windowsCreate({
          focused: false,
        });
        const isTestWindow1Valid = testWindow1.tabs.length === 1;

        const windowsAfter = await new Promise(r =>
          chrome.windows.getAll({ populate: true }, r)
        );
        const areWindowsAfterValid =
          windowsAfter.length === windowsBefore.length + 1 &&
          windowsAfter[windowsBefore.length].tabs[0].title === 'New Tab';

        // cleanup
        await removeTestWindow(testWindow1.id, false);

        return assertTrue(isTestWindow1Valid && areWindowsAfterValid);
      },

      // Test gsChrome.windowsGet
      async () => {
        // stub gsUtils.warning function
        let warningString;
        gsUtils.warning = (id, _warningString, ...args) => {
          warningString = _warningString;
        };

        // create a test window
        const testWindow1 = await new Promise(r =>
          chrome.windows.create({ focused: false }, r)
        );
        const isTestWindow1Valid = testWindow1.tabs.length === 1;

        const window1 = await gsChrome.windowsGet();
        const isWindow1Valid =
          window1 === null && warningString === 'windowId not specified';

        const window2 = await gsChrome.windowsGet(7777);
        const isWindow2Valid =
          window2 === null &&
          warningString.message === 'No window with id: 7777.';

        const window3 = await gsChrome.windowsGet(testWindow1.id);
        const isWindow3Valid = window3.id === testWindow1.id;

        // cleanup
        await removeTestWindow(testWindow1.id, false);

        return assertTrue(
          isTestWindow1Valid &&
            isWindow1Valid &&
            isWindow2Valid &&
            isWindow3Valid
        );
      },

      // Test gsChrome.windowsGetLastFocused
      async () => {
        const testWindow1 = await gsChrome.windowsGetLastFocused();
        const isTestWindow1Valid = testWindow1.focused === true;

        // create a test window
        const testWindow2a = await new Promise(r =>
          chrome.windows.create({ focused: true }, r)
        );
        const testWindow2b = await gsChrome.windowsGetLastFocused();
        const isTestWindow2Valid =
          testWindow2b.focused === true &&
          testWindow2b.id !== testWindow1.id &&
          testWindow2b.id === testWindow2a.id;

        await removeTestWindow(testWindow2a.id, false);

        const testWindow3 = await gsChrome.windowsGetLastFocused();
        const isTestWindow3Valid =
          testWindow3.focused === true && testWindow3.id === testWindow1.id;

        return assertTrue(
          isTestWindow1Valid && isTestWindow2Valid && isTestWindow3Valid
        );
      },

      // Test gsChrome.windowsGetAll
      async () => {
        const windowsBefore = await gsChrome.windowsGetAll();

        // create a test window
        const testWindow1 = await new Promise(r =>
          chrome.windows.create({ focused: false }, r)
        );
        const isTestWindow1Valid = testWindow1.tabs.length === 1;

        const windowsAfter = await gsChrome.windowsGetAll();
        const areWindowsAfterValid =
          windowsAfter.length === windowsBefore.length + 1 &&
          windowsAfter[windowsBefore.length].tabs[0].title === 'New Tab';

        // cleanup
        await removeTestWindow(testWindow1.id, false);

        return assertTrue(isTestWindow1Valid && areWindowsAfterValid);
      },

      // Test gsChrome.windowsUpdate
      async () => {
        // stub gsUtils.warning function
        let warningString;
        gsUtils.warning = (id, _warningString, ...args) => {
          warningString = _warningString;
        };

        // create a test window to update
        const testWindow1 = await new Promise(r =>
          chrome.windows.create({ focused: false }, r)
        );
        const isTestWindow1Valid = testWindow1.tabs.length === 1;

        const updateWindow1 = await gsChrome.windowsUpdate();
        const isUpdateWindow1Valid =
          updateWindow1 === null &&
          warningString === 'windowId or updateInfo not specified';

        const updateWindow2 = await gsChrome.windowsUpdate(testWindow1.id);
        const isUpdateWindow2Valid =
          updateWindow2 === null &&
          warningString === 'windowId or updateInfo not specified';

        const updateWindow3 = await gsChrome.windowsUpdate(7777, {});
        const isUpdateWindow3Valid =
          updateWindow3 === null &&
          warningString.message === 'No window with id: 7777.';

        const testWidth = 500;
        const isUpdateWindow4BeforeValid = testWindow1.width !== testWidth;
        const updateWindow4 = await gsChrome.windowsUpdate(testWindow1.id, {
          width: testWidth,
        });
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
