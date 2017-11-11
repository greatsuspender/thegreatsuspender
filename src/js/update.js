/*global chrome, historyUtils */
(function () {
    'use strict';

    var gsStorage = chrome.extension.getBackgroundPage().gsStorage;
    var gsUtils = chrome.extension.getBackgroundPage().gsUtils;

    gsUtils.documentReadyAndLocalisedAsPromsied(document).then(function () {

        document.getElementById('sessionManagerLink').onclick = function (e) {
            e.preventDefault();
            chrome.tabs.create({ url: chrome.extension.getURL('history.html') });
        };
        document.getElementById('restartExtensionBtn').onclick = function (e) {
            var result = window.confirm(chrome.i18n.getMessage('js_update_confirm'));
            if (result) {
                chrome.runtime.reload();
            }
        };

        var currentVersion = chrome.runtime.getManifest().version;
        gsStorage.fetchSessionRestorePoint(gsStorage.DB_SESSION_PRE_UPGRADE_KEY, currentVersion)
            .then(function (sessionRestorePoint) {
                if (!sessionRestorePoint) {
                    gsUtils.log('Couldnt find session restore point. Something has gone horribly wrong!!');
                    document.getElementById('noBackupInfo').style.display = 'block';
                    document.getElementById('backupInfo').style.display = 'none';
                    document.getElementById('exportBackupBtn').style.display = 'none';
                } else {
                    document.getElementById('exportBackupBtn').onclick = function (e) {
                        historyUtils.exportSession(sessionRestorePoint.sessionId);
                        document.getElementById('exportBackupBtn').style.display = 'none';
                        document.getElementById('restartExtensionBtn').onclick = function (e) {
                            chrome.runtime.reload();
                        };
                    };
                }
            });
    });
}());
