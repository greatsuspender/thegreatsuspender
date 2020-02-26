import {
  getFixture,
  assertTrue,
  FIXTURE_CURRENT_SESSIONS,
  FIXTURE_PREVIEW_URLS,
} from './tests.js';
import * as gsIndexedDb from '../gsIndexedDb';
import * as suspendTab from '../actions/suspendTab';

export default (function() {
  const tests = [
    // Test functions associated with suspending a tab
    async () => {
      const session1 = await getFixture(
        FIXTURE_CURRENT_SESSIONS,
        'currentSession1'
      );
      const tab = session1.windows[0].tabs[0];
      const previewUrl = await getFixture(FIXTURE_PREVIEW_URLS, 'previewUrl1');

      await suspendTab.saveSuspendData(tab);
      const tabProperties = await gsIndexedDb.fetchTabInfo(tab.url);
      const isTabPropertiesValid =
        tabProperties.url === tab.url &&
        tabProperties.title === tab.title &&
        tabProperties.favIconUrl === tab.favIconUrl;

      await gsIndexedDb.addPreviewImage(tab.url, previewUrl);
      const preview = await gsIndexedDb.fetchPreviewImage(tab.url);
      const isPreviewValid = preview.img === previewUrl;

      return assertTrue(isTabPropertiesValid && isPreviewValid);
    },
  ];

  return {
    name: 'Suspend Tab',
    tests,
  };
})();
