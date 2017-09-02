/*global chrome, sessionItems */
(function () {
    'use strict';

    var gsUtils = chrome.extension.getBackgroundPage().gsUtils;

    function render() {

        var currentDiv = document.getElementById('currentLinks'),
            sessionsDiv = document.getElementById('recoveryLinks'),
            historyDiv = document.getElementById('historyLinks'),
            clearHistoryEl = document.getElementById('clearHistory'),
            firstSession = true;

        currentDiv.innerHTML = '';
        sessionsDiv.innerHTML = '';
        historyDiv.innerHTML = '';

        gsUtils.fetchCurrentSessions().then(function (currentSessions) {

            currentSessions.forEach(function (session, index) {
                if (firstSession) {
                    currentDiv.appendChild(sessionItems.createSessionHtml(session));
                    firstSession = false;
                } else {
                    sessionsDiv.appendChild(sessionItems.createSessionHtml(session));
                }
            });
        });

        gsUtils.fetchSavedSessions().then(function (savedSessions) {
            savedSessions.forEach(function (session, index) {
                historyDiv.appendChild(sessionItems.createSessionHtml(session));
            });
        });

        clearHistoryEl.onclick = function (e) {
            gsUtils.clearGsSessions();
            render();
        };

        //hide incompatible sidebar items if in incognito mode
        if (chrome.extension.inIncognitoContext) {
            Array.prototype.forEach.call(document.getElementsByClassName('noIncognito'), function (el) {
                el.style.display = 'none';
            });
        }

    }

    gsUtils.documentReadyAndLocalisedAsPromsied(document).then(function () {
        render();
    });
}());
