/*global chrome, gsUtils, render, createWindowHtml, createTabHtml */

(function () {

    'use strict';

    function render() {

        var gsSessionHistory = gsUtils.fetchGsSessionHistory(),
            currentDiv = document.getElementById('currentLinks'),
            sessionsDiv = document.getElementById('recoveryLinks'),
            historyDiv = document.getElementById('historyLinks'),
            clearHistoryEl = document.getElementById('clearHistory'),
            firstSession = true;

        sessionUtils.hideModal();
        currentDiv.innerHTML = '';
        sessionsDiv.innerHTML = '';
        historyDiv.innerHTML = '';

        gsSessionHistory.forEach(function (session, index) {
            //saved sessions will all have a 'name' attribute
            if (session.name) {
                historyDiv.appendChild(sessionUtils.createSessionHtml(session));
            } else if (firstSession) {
                currentDiv.appendChild(sessionUtils.createSessionHtml(session));
                firstSession = false;
            } else {
                sessionsDiv.appendChild(sessionUtils.createSessionHtml(session));
            }
        });

        clearHistoryEl.onclick = function (e) {
            gsUtils.clearGsSessionHistory();
            render();
        };
    }

    window.onload = function () {
        render();
    };

}());
