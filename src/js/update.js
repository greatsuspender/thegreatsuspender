/*global chrome, historyUtils */
(function() {
  'use strict';

  var gsSession = chrome.extension.getBackgroundPage().gsSession;
  var gsIndexedDb = chrome.extension.getBackgroundPage().gsIndexedDb;
  var gsUtils = chrome.extension.getBackgroundPage().gsUtils;

  function setRestartExtensionClickHandler(warnFirst) {
    document.getElementById('restartExtensionBtn').onclick = async function(e) {
      // var result = true;
      // if (warnFirst) {
      //   result = window.confirm(chrome.i18n.getMessage('js_update_confirm'));
      // }
      // if (result) {

      const currentSession = await gsSession.buildCurrentSession();
      if (currentSession) {
        var currentVersion = chrome.runtime.getManifest().version;
        await gsIndexedDb.createOrUpdateSessionRestorePoint(
          currentSession,
          currentVersion
        );
      }
      chrome.runtime.reload();
      // }
    };
  }

  function setExportBackupClickHandler() {
    document.getElementById('exportBackupBtn').onclick = async function(e) {
      const currentSession = await gsSession.buildCurrentSession();
      historyUtils.exportSession(currentSession, function () {
        document.getElementById('exportBackupBtn').style.display = 'none';
        setRestartExtensionClickHandler(false);
      });
    };
  }

  function setSessionManagerClickHandler() {
    document.getElementById('sessionManagerLink').onclick = function(e) {
      e.preventDefault();
      chrome.tabs.create({ url: chrome.extension.getURL('history.html') });
      setRestartExtensionClickHandler(false);
    };
  }

  gsUtils.documentReadyAndLocalisedAsPromsied(document).then(function() {
    setSessionManagerClickHandler();
    setRestartExtensionClickHandler(true);
    setExportBackupClickHandler();

    var currentVersion = chrome.runtime.getManifest().version;
    gsIndexedDb
      .fetchSessionRestorePoint(currentVersion)
      .then(function(sessionRestorePoint) {
        if (!sessionRestorePoint) {
          gsUtils.log(
            'update',
            'Couldnt find session restore point. Something has gone horribly wrong!!'
          );
          document.getElementById('noBackupInfo').style.display = 'block';
          document.getElementById('backupInfo').style.display = 'none';
          document.getElementById('exportBackupBtn').style.display = 'none';
        }
      });
  });
})();
