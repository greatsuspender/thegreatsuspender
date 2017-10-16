/*global chrome, historyItems, historyUtils */
(function () {
    'use strict';

    var gsSession = chrome.extension.getBackgroundPage().gsSession;
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

        Array.prototype.forEach.call(document.getElementsByClassName('sessionManagerLink'), function (el) {
            el.onclick = function (e) {
                e.preventDefault();
                chrome.tabs.create({ url: chrome.extension.getURL('history.html') });
            };
        });
        document.getElementById('restartExtensionBtn').onclick = function (e) {
            var result = window.confirm(chrome.i18n.getMessage('js_update_confirm'));
            if (result) {
                chrome.runtime.reload();
            }
        };
        document.getElementById('exportBackupBtn').onclick = function (e) {
            historyUtils.exportSession(sessionRestorePoint.sessionId);
            document.getElementById('exportBackupBtn').style.display = 'none';
            document.getElementById('restartExtensionBtn').onclick = function (e) {
                chrome.runtime.reload();
            };
        };

        var sessionRestorePoint = gsSession.getSessionRestorePoint();
        if (!sessionRestorePoint) {
            gsUtils.log('Couldnt find session restore point. Something has gone horribly wrong!!');
            document.getElementById('backupInfo').style.display = 'none';
            document.getElementById('noBackupInfo').style.display = 'block';
            document.getElementById('exportBackupBtn').style.display = 'none';
        } else {
            var sessionEl = historyItems.createSessionHtml(sessionRestorePoint, false);
            document.getElementById('savedSession').appendChild(sessionEl);
            sessionEl.onclick = function (e) {
                toggleSession(sessionEl, sessionRestorePoint);
            };
        }
    });
}());
