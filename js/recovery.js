/*global chrome */

(function () {

    'use strict';

    var readyStateCheckInterval = window.setInterval(function () {
        if (document.readyState === 'complete') {

            window.clearInterval(readyStateCheckInterval);

            var lastSession = gsUtils.fetchLastSession(),
                restoreEl = document.getElementById('restoreSession'),
                manageEl = document.getElementById('manageManuallyLink'),
                previewsEl = document.getElementById('previewsOffBtn'),
                warningEl = document.getElementById('screenCaptureNotice'),
                recoveryEl = document.getElementById('recoverySession'),
                sessionEl,
                sessionTitleEl;

            restoreEl.onclick = function (e) {
                gsUtils.recoverLostTabs();
                chrome.tabs.getCurrent(function(t) {chrome.tabs.remove(t.id);});
            };
            manageEl.onclick = function (e) {
                chrome.tabs.create({url: chrome.extension.getURL('history.html')});
            };
            previewsEl.onclick = function (e) {
                gsUtils.setOption(gsUtils.SHOW_PREVIEW, false);
                location.reload();
            };

            //show warning if screen capturing turned on
            if (gsUtils.getOption(gsUtils.SHOW_PREVIEW)) {
                warningEl.style.display = 'block';
            }

            if (lastSession) {
                sessionEl = sessionUtils.createSessionHtml(lastSession, true);
                recoveryEl.appendChild(sessionEl);
                sessionTitleEl = document.getElementsByClassName('sessionLink')[0];
                if (typeof sessionTitleEl.onclick == "function") {
                    sessionTitleEl.onclick.apply(sessionTitleEl);
                }
            }
        }
    }, 50);

}());
