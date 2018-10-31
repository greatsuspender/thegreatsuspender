/*global chrome, gsSession, gsUtils */
(function(global) {
  'use strict';

  const backgroundPage = chrome.extension.getBackgroundPage();
  if (!backgroundPage || !backgroundPage.tgs) {
    setTimeout(() => location.replace(location.href), 1000);
    return;
  }
  backgroundPage.tgs.setViewGlobals(global, 'updated');

  function toggleUpdated() {
    document.getElementById('updating').style.display = 'none';
    document.getElementById('updated').style.display = 'block';
  }

  gsUtils.documentReadyAndLocalisedAsPromsied(document).then(function() {
    var versionEl = document.getElementById('updatedVersion');
    versionEl.innerHTML = 'v' + chrome.runtime.getManifest().version;

    document.getElementById('sessionManagerLink').onclick = function(e) {
      e.preventDefault();
      chrome.tabs.create({ url: chrome.extension.getURL('history.html') });
    };

    var updateType = gsSession.getUpdateType();
    if (updateType === 'major') {
      document.getElementById('patchMessage').style.display = 'none';
      document.getElementById('minorUpdateDetail').style.display = 'none';
    } else if (updateType === 'minor') {
      document.getElementById('patchMessage').style.display = 'none';
      document.getElementById('majorUpdateDetail').style.display = 'none';
    } else {
      document.getElementById('updateDetail').style.display = 'none';
    }

    if (gsSession.isUpdated()) {
      toggleUpdated();
    }
  });

  global.exports = {
    toggleUpdated,
  };
})(this);
