/*global chrome */
(function() {
  'use strict';

  var gsIndexedDb = chrome.extension.getBackgroundPage().gsIndexedDb;
  var gsSession = chrome.extension.getBackgroundPage().gsSession;
  var gsUtils = chrome.extension.getBackgroundPage().gsUtils;

  gsUtils.documentReadyAndLocalisedAsPromsied(document).then(function() {
    var versionEl = document.getElementById('updatedVersion');
    versionEl.innerHTML = 'v' + chrome.runtime.getManifest().version;

    document.getElementById('sessionManagerLink').onclick = function(e) {
      e.preventDefault();
      chrome.tabs.create({ url: chrome.extension.getURL('history.html') });
    };

    var currentVersion = chrome.runtime.getManifest().version;
    var updateType = gsSession.getUpdateType();
    gsIndexedDb
      .fetchSessionRestorePoint(
        gsIndexedDb.DB_SESSION_POST_UPGRADE_KEY,
        currentVersion
      )
      .then(function(sessionRestorePoint) {
        if (!sessionRestorePoint) {
          gsUtils.log(
            'updated',
            'Couldnt find session restore point. Something has gone horribly wrong!!'
          );
        } else {
          document.getElementById('backupInfo').style.display = 'block';
        }
      });
    if (updateType === 'major' || updateType === 'minor') {
      document.getElementById('patchMessage').style.display = 'none';
    } else {
      document.getElementById('majorUpdateDetail').style.display = 'none';
    }
  });
})();
