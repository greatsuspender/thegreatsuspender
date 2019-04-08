/*global chrome, historyUtils, gsSession, gsIndexedDb, gsUtils */
(function(global) {
  'use strict';

  try {
    chrome.extension.getBackgroundPage().tgs.setViewGlobals(global);
  } catch (e) {
    window.setTimeout(() => window.location.reload(), 1000);
    return;
  }

  function setRestartExtensionClickHandler(warnFirst) {
    document.getElementById('restartExtensionBtn').onclick = async function(e) {
      // var result = true;
      // if (warnFirst) {
      //   result = window.confirm(chrome.i18n.getMessage('js_update_confirm'));
      // }
      // if (result) {

      document.getElementById('restartExtensionBtn').className += ' btnDisabled';
      document.getElementById('restartExtensionBtn').onclick = null;

      const currentSession = await gsSession.buildCurrentSession();
      if (currentSession) {
        var currentVersion = chrome.runtime.getManifest().version;
        await gsIndexedDb.createOrUpdateSessionRestorePoint(
          currentSession,
          currentVersion
        );
      }

      //ensure we don't leave any windows with no unsuspended tabs
      await gsSession.unsuspendActiveTabInEachWindow();

      //update current session to ensure the new tab ids are saved before
      //we restart the extension
      await gsSession.updateCurrentSession();

      chrome.runtime.reload();
      // }
    };
  }

  function setExportBackupClickHandler() {
    document.getElementById('exportBackupBtn').onclick = async function(e) {
      const currentSession = await gsSession.buildCurrentSession();
      historyUtils.exportSession(currentSession, function() {
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
          gsUtils.warning(
            'update',
            'Couldnt find session restore point. Something has gone horribly wrong!!'
          );
          document.getElementById('noBackupInfo').style.display = 'block';
          document.getElementById('backupInfo').style.display = 'none';
          document.getElementById('exportBackupBtn').style.display = 'none';
        }
      });
  });
})(this);
