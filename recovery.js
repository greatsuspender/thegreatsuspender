/*global chrome */

(function () {

    'use strict';

    var readyStateCheckInterval = window.setInterval(function () {
        if (document.readyState === 'complete') {

            window.clearInterval(readyStateCheckInterval);

            var restoreEl = document.getElementById('restoreSession'),
                cancelEl = document.getElementById('closeTab');

            restoreEl.onclick = function (e) {
                gsUtils.recoverLostTabs();
                chrome.tabs.getCurrent(function(t) {chrome.tabs.remove(t.id);});
            };
            cancelEl.onclick = function (e) {
                chrome.tabs.getCurrent(function(t) {chrome.tabs.remove(t.id);});
            };
        }
    }, 50);

}());
