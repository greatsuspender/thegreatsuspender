/*global chrome */

(function () {

    'use strict';

    var readyStateCheckInterval = window.setInterval(function () {
        if (document.readyState === 'complete') {

            window.clearInterval(readyStateCheckInterval);

            var gsSessionHistory = gsUtils.fetchGsSessionHistory(),
                restoreEl = document.getElementById('restoreSession'),
                cancelEl = document.getElementById('closeTab'),
                manageEl = document.getElementById('manageManuallyLink'),
                optionsEl = document.getElementById('optionsLink'),
                warningEl = document.getElementById('screenCaptureNotice'),
                recoveryEl = document.getElementById('recoverySession');

            restoreEl.onclick = function (e) {
                debugger;
                gsUtils.recoverLostTabs();
                chrome.tabs.getCurrent(function(t) {chrome.tabs.remove(t.id);});
            };
            cancelEl.onclick = function (e) {
                chrome.tabs.getCurrent(function(t) {chrome.tabs.remove(t.id);});
            };
            manageEl.onclick = function (e) {
                chrome.tabs.create({url: chrome.extension.getURL('history.html')});
            };
            optionsEl.onclick = function (e) {
                chrome.tabs.create({url: chrome.extension.getURL('options.html')});
            };

            //show warning if screen capturing turned on
            if (gsUtils.getOption(gsUtils.SHOW_PREVIEW)) {
                warningEl.style.display = 'block';
            }

            gsSessionHistory.some(function (session, index) {
                //saved sessions will all have a 'name' attribute
                if (!session.name) {
                    recoveryEl.appendChild(sessionUtils.createSessionHtml(session));
                }
                return true;
            });
        }
    }, 50);

}());
