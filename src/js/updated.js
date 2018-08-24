/*global chrome */
(function() {
  'use strict';

  var gsStorage = chrome.extension.getBackgroundPage().gsStorage;
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
    gsStorage
      .fetchSessionRestorePoint(
        gsStorage.DB_SESSION_POST_UPGRADE_KEY,
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
