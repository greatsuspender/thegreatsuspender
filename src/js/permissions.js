/*global chrome, historyUtils */
(function() {
  'use strict';
  if (
    !chrome.extension.getBackgroundPage() ||
    !chrome.extension.getBackgroundPage().gsUtils
  ) {
    window.setTimeout(() => location.replace(location.href), 1000);
    return;
  }


  var gsSession = chrome.extension.getBackgroundPage().gsSession;
  var gsChrome = chrome.extension.getBackgroundPage().gsChrome;
  var gsUtils = chrome.extension.getBackgroundPage().gsUtils;
  var gsAnalytics = chrome.extension.getBackgroundPage().gsAnalytics;

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
})();
