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
            var updateSuspendedTabCount = function (suspendedTabCount) {
                if (suspendedTabCount > 0) {
                    if (!unsuspending) {
                        suspendedTabCountEl.innerHTML = 'You have <strong>' + suspendedTabCount + '</strong> tabs currently suspended.';
                    } else {
                        suspendedTabCountEl.innerHTML = 'Unsuspending all tabs. You still have <strong>' + suspendedTabCount + '</strong> tabs currently suspended.';
                    }
                } else {
                    suspendedTabCountEl.innerHTML = 'You have no suspended tabs. It is now safe to update the extension :)';
                    unsuspendedAllBtnEl.style = "display: none";
                }
            }

            unsuspendedAllBtnEl.onclick = function (e) {

                if (unsuspending) {
                    return;
                } else {
                    unsuspending = true;
                }
                unsuspendedAllBtnEl.className += ' btnDisabled'
                chrome.runtime.sendMessage({ action: 'unsuspendAllInAllWindows' });

                var unsuspendedTabsCheckInterval = window.setInterval(function () {
                    var newSuspendedTabCount = gsUtils.getSuspendedTabCount();
                    updateSuspendedTabCount(newSuspendedTabCount);
                    if (newSuspendedTabCount === 0) {
                        window.clearInterval(unsuspendedTabsCheckInterval);
                    }
                }, 500);
            };
            reloadExtensionBtnEl.onclick = function (e) {
                var newSuspendedTabCount = gsUtils.getSuspendedTabCount();
                if (newSuspendedTabCount > 0) {
                    var result = window.confirm('Are you sure you want to update the extension? You still have ' + newSuspendedTabCount + ' tabs suspended');
                    if (result) {
                        chrome.runtime.reload();
                    }
                } else {
                    chrome.runtime.reload();
                }
            };

            var suspendedTabCount = gsUtils.getSuspendedTabCount();
            updateSuspendedTabCount(suspendedTabCount);
        }
    }, 50);

}());
