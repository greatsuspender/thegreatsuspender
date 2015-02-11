/*global chrome */

(function () {

    'use strict';

    function removeTabFromList(url) {

        var recoveryLinksEl = document.getElementById('recoveryLinks'),
            childLinks = recoveryLinksEl.children;

        for (var i = 0; i < childLinks.length; i++) {
            var element = childLinks[i];
            if (element.getAttribute('data-url') === url) {
                recoveryLinksEl.removeChild(element);
            }
        }

        //if removing the last element
        if (recoveryLinks.children.length === 0) {
            window.location.href = chrome.extension.getURL('success.html');
        }
    }

    function populateMissingTabs() {

        var lastSession = gsUtils.fetchLastSession(),
            recoveryEl = document.getElementById('recoveryLinks'),
            tabEl,
            tabProperties;

        if (lastSession) {

            lastSession.windows.forEach(function (window, index) {

                window.tabs.forEach(function (tab) {
                    tabProperties = tab;
                    tabProperties.windowId = window.id;
                    tabProperties.sessionId = lastSession.id;
                    tabEl = sessionUtils.createTabHtml(tabProperties, true);
                    tabEl.onclick = function(e) {
                        e.preventDefault();
                        chrome.tabs.create({url: tab.url, active: false});
                        removeTabFromList(tab.url);
                    }
                    recoveryEl.appendChild(tabEl);
                });
            });
            checkForActiveTabs();
        }
    }

    function checkForActiveTabs() {

        //hide tabs that respond to getInfo request
        chrome.windows.getAll({ populate: true }, function (windows) {
            windows.forEach(function (curWindow) {
                curWindow.tabs.forEach(function (curTab) {
                    chrome.tabs.sendMessage(curTab.id, {action: 'requestInfo'}, function (response) {
                        removeTabFromList(curTab.url);
                    });
                });
            });
        });
    }

    var readyStateCheckInterval = window.setInterval(function () {
        if (document.readyState === 'complete') {

            window.clearInterval(readyStateCheckInterval);

            var restoreEl = document.getElementById('restoreSession'),
                manageEl = document.getElementById('manageManuallyLink'),
                previewsEl = document.getElementById('previewsOffBtn'),
                warningEl = document.getElementById('screenCaptureNotice');

            restoreEl.onclick = function (e) {
                gsUtils.recoverLostTabs();
                window.location.reload();
            };
            manageEl.onclick = function (e) {
                window.location.href = chrome.extension.getURL('history.html');
            };

            if (previewsEl) {
                previewsEl.onclick = function (e) {
                    gsUtils.setOption(gsUtils.SHOW_PREVIEW, false);
                    window.location.reload();
                };

                //show warning if screen capturing turned on
                if (gsUtils.getOption(gsUtils.SHOW_PREVIEW)) {
                    warningEl.style.display = 'block';
                }
            }

            populateMissingTabs();

        }
    }, 50);

}());
