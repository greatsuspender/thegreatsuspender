/*global chrome, historyUtils, gsSession, gsChrome, gsUtils, gsAnalytics */
(function(global) {
  'use strict';

  const backgroundPage = chrome.extension.getBackgroundPage();
  if (!backgroundPage || !backgroundPage.tgs) {
    setTimeout(() => location.replace(location.href), 1000);
    return;
  }
  backgroundPage.tgs.setViewGlobals(global, 'permissions');

  gsUtils.documentReadyAndLocalisedAsPromsied(document).then(function() {
    document.getElementById('exportBackupBtn').onclick = async function(e) {
      const currentSession = await gsSession.buildCurrentSession();
      historyUtils.exportSession(currentSession, function() {
        document.getElementById('exportBackupBtn').style.display = 'none';
      });
    };
    document.getElementById('setFilePermissiosnBtn').onclick = async function(e) {
      await gsChrome.tabsCreate({ url: 'chrome://extensions?id=' + chrome.runtime.id });
    };
  });
  gsAnalytics.reportPageView('permissions.html');
})(this);
