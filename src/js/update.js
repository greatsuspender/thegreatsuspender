/*global chrome */
(function () {
    'use strict';

    var gsUtils = chrome.extension.getBackgroundPage().gsUtils;
    var tgs = chrome.extension.getBackgroundPage().tgs;

    var unsuspending = false;

    var updateSuspendedTabCount = function () {
        var suspendedTabCount = gsUtils.getSuspendedTabCount();
        if (suspendedTabCount > 0) {
            if (!unsuspending) {
                document.getElementById('suspendedTabCount').innerHTML = 'You have <strong>' + suspendedTabCount + '</strong> tabs currently suspended.';
            } else {
                document.getElementById('suspendedTabCount').innerHTML = 'Unsuspending all tabs. You still have <strong>' + suspendedTabCount + '</strong> tabs currently suspended.';
            }
        } else {
            document.getElementById('suspendedTabCount').innerHTML = chrome.i18n.getMessage('js_update_ready');
            document.getElementById('unsuspendAllBtn').style = 'display: none';
        }
        return suspendedTabCount;
    };

    gsUtils.documentReadyAndLocalisedAsPromsied(document).then(function () {

        document.getElementById('unsuspendAllBtn').onclick = function (e) {
            if (unsuspending) {
                return;
            }
            unsuspending = true;
            document.getElementById('unsuspendAllBtn').classList.add('btnDisabled');
            document.getElementById('unsuspendAllBtn').innerHTML = "<i class='fa fa-spinner fa-spin '></i> Unsuspending tabs";
            updateSuspendedTabCount();

            tgs.unsuspendAllTabsInAllWindows();
        };
        document.getElementById('restartExtensionBtn').onclick = function (e) {
            var newSuspendedTabCount = gsUtils.getSuspendedTabCount();
            if (newSuspendedTabCount > 0) {
                var result = window.confirm(chrome.i18n.getMessage('js_update_confirm'));
                if (result) {
                    chrome.runtime.reload();
                }
            } else {
                chrome.runtime.reload();
            }
        };
        updateSuspendedTabCount();
    });

    //listen for background events
    chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
        switch (request.action) {

        case 'reportTabState':
            updateSuspendedTabCount();
            return false;

        case 'initTab':
            updateSuspendedTabCount();
            return false;
        }
    });
}());
