/*global chrome, historyItems, historyUtils */
(function () {
    'use strict';

    var gsStorage = chrome.extension.getBackgroundPage().gsStorage;
    var gsUtils = chrome.extension.getBackgroundPage().gsUtils;

    function toggleSession(sessionEl, session) {
        var sessionContentsEl = sessionEl.getElementsByClassName('sessionContents')[0];
        var sessionIcon = sessionEl.getElementsByClassName('sessionIcon')[0];

        //if toggled on already, then toggle off
        if (sessionContentsEl.childElementCount > 0) {
            sessionContentsEl.innerHTML = '';
            sessionIcon.classList.remove('fa-minus-square-o');
            sessionIcon.classList.add('fa-plus-square-o');
            return;
        }
        if (!session || !session.windows) {
            return;
        }

        sessionIcon.classList.remove('fa-plus-square-o');
        sessionIcon.classList.add('fa-minus-square-o');
        session.windows.forEach(function (curWindow, index) {
            curWindow.sessionId = session.sessionId;
            sessionContentsEl.appendChild(historyItems.createWindowHtml(curWindow, index, false));

            curWindow.tabs.forEach(function (curTab) {
                curTab.windowId = curWindow.id;
                curTab.sessionId = session.sessionId;
                sessionContentsEl.appendChild(historyItems.createTabHtml(curTab, false));
            });
        });
    }

    gsUtils.documentReadyAndLocalisedAsPromsied(document).then(function () {

        var versionEl = document.getElementById('updatedVersion');
        versionEl.innerHTML = 'v' + chrome.runtime.getManifest().version;

        document.getElementById('sessionManagerLink').onclick = function (e) {
            e.preventDefault();
            chrome.tabs.create({ url: chrome.extension.getURL('history.html') });
        };

        var currentVersion = chrome.runtime.getManifest().version;
        gsStorage.fetchSessionRestorePoint(gsStorage.DB_SESSION_POST_UPGRADE_KEY, currentVersion)
            .then(function (sessionRestorePoint) {
                if (!sessionRestorePoint) {
                    gsUtils.log('Couldnt find session restore point. Something has gone horribly wrong!!');
                } else {
                    // var sessionEl = historyItems.createSessionHtml(sessionRestorePoint, false);
                    // document.getElementById('savedSession').appendChild(sessionEl);
                    // sessionEl.onclick = function (e) {
                    //     toggleSession(sessionEl, sessionRestorePoint);
                    // };
                    document.getElementById('backupInfo').style.display = 'block';
                }
            });
    });
}());
