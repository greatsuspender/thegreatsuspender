/*global chrome, historyUtils */
(function() {
  'use strict';

  var gsStorage = chrome.extension.getBackgroundPage().gsStorage;
  var gsUtils = chrome.extension.getBackgroundPage().gsUtils;

  function setRestartExtensionClickHandler(warnFirst) {
    document.getElementById('restartExtensionBtn').onclick = function(e) {
      // var result = true;
      // if (warnFirst) {
      //   result = window.confirm(chrome.i18n.getMessage('js_update_confirm'));
      // }
      // if (result) {
      chrome.runtime.reload();
      // }
    };
  }

  function setExportBackupClickHandler(sessionRestorePoint) {
    document.getElementById('exportBackupBtn').onclick = function(e) {
      historyUtils.exportSession(sessionRestorePoint.sessionId);
      document.getElementById('exportBackupBtn').style.display = 'none';
      setRestartExtensionClickHandler(false);
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

    var currentVersion = chrome.runtime.getManifest().version;
    gsStorage
      .fetchSessionRestorePoint(
        gsStorage.DB_SESSION_PRE_UPGRADE_KEY,
        currentVersion
      )
      .then(function(sessionRestorePoint) {
        if (!sessionRestorePoint) {
          gsUtils.log(
            'update',
            'Couldnt find session restore point. Something has gone horribly wrong!!'
          );
          document.getElementById('noBackupInfo').style.display = 'block';
          document.getElementById('backupInfo').style.display = 'none';
          document.getElementById('exportBackupBtn').style.display = 'none';
        } else {
          setExportBackupClickHandler(sessionRestorePoint);
        }
      });
  });
})();
