/*global chrome */

(function () {

    'use strict';

    var readyStateCheckInterval = window.setInterval(function () {
        if (document.readyState === 'complete') {

            window.clearInterval(readyStateCheckInterval);

            var restoreEl = document.getElementById('restoreSession'),
                cancelEl = document.getElementById('closeTab'),
                manageEl = document.getElementById('manageManuallyLink');

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
        }
    }, 50);

}());
