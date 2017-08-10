/*global chrome */

(function () {

    'use strict';

    var readyStateCheckInterval = window.setInterval(function () {
        if (document.readyState === 'complete') {

            window.clearInterval(readyStateCheckInterval);

            var gsUtils = chrome.extension.getBackgroundPage().gsUtils;

            var suspendedTabCountEl = document.getElementById('suspendedTabCount');
            var unsuspendedAllBtnEl = document.getElementById('unsuspendAllBtn');
            var reloadExtensionBtnEl = document.getElementById('restartExtensionBtn');

            var unsuspending = false;
            var updateSuspendedTabCount = function () {
                var suspendedTabCount = gsUtils.getSuspendedTabCount();
                if (suspendedTabCount > 0) {
                    if (!unsuspending) {
                        suspendedTabCountEl.innerHTML = 'You have <strong>' + suspendedTabCount + '</strong> tabs currently suspended.';
                    } else {
                        suspendedTabCountEl.innerHTML = 'Unsuspending all tabs. You still have <strong>' + suspendedTabCount + '</strong> tabs currently suspended.';
                    }
                } else {
                    suspendedTabCountEl.innerHTML = 'You have no suspended tabs. It is now safe to update the extension :)';
                    unsuspendedAllBtnEl.style = 'display: none';
                }
                return suspendedTabCount;
            };

            unsuspendedAllBtnEl.onclick = function (e) {

                if (unsuspending) {
                    return;
                }

                unsuspending = true;
                unsuspendedAllBtnEl.classList.add('btnDisabled');
                unsuspendedAllBtnEl.innerHTML = "<i class='fa fa-spinner fa-spin '></i> Unsuspending tabs";
                updateSuspendedTabCount();

                chrome.runtime.sendMessage({ action: 'unsuspendAllInAllWindows' });

                var unsuspendedTabsCheckInterval = window.setInterval(function () {
                    var newSuspendedTabCount = updateSuspendedTabCount();
                    if (newSuspendedTabCount === 0) {
                        window.clearInterval(unsuspendedTabsCheckInterval);
                    }
                }, 500);
            };
            reloadExtensionBtnEl.onclick = function (e) {
                var newSuspendedTabCount = gsUtils.getSuspendedTabCount();
                if (newSuspendedTabCount > 0) {
                    var result = window.confirm('Are you sure you want to update the extension now? To prevent tab loss, unsuspend all tabs before updating.');
                    if (result) {
                        chrome.runtime.reload();
                    }
                } else {
                    chrome.runtime.reload();
                }
            };

            updateSuspendedTabCount();
        }
    }, 50);

}());
