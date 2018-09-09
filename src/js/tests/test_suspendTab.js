/*global chrome, gsStorage, gsSuspendManager, getFixture, assertTrue, FIXTURE_CURRENT_SESSIONS, FIXTURE_PREVIEW_URLS */
var testSuites = typeof testSuites === 'undefined' ? [] : testSuites;
testSuites.push(
  (function() {
    'use strict';

    const tests = [
      // Test functions associated with suspending a tab
      async () => {
        const session1 = await getFixture(FIXTURE_CURRENT_SESSIONS, 'currentSession1');
        const tab = session1.windows[0].tabs[0];
        const previewUrl = await getFixture(FIXTURE_PREVIEW_URLS, 'previewUrl1');

        await new Promise(r => gsSuspendManager.saveSuspendData(tab, r));
        const tabProperties = await gsStorage.fetchTabInfo(tab.url);
        const isTabPropertiesValid =
          tabProperties.url === tab.url &&
          tabProperties.title === tab.title &&
          tabProperties.favicon === 'chrome://favicon/size/16@2x/' + tab.url;;

        await gsStorage.addPreviewImage(tab.url, previewUrl);
        const preview = await gsStorage.fetchPreviewImage(tab.url);
        const isPreviewValid = preview.img === previewUrl;

        return assertTrue(isTabPropertiesValid && isPreviewValid);
      },
    ];

    return {
      name: 'Suspend Tab',
      tests,
    };
  })()
);
