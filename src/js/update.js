/*global chrome */
(function () {
    'use strict';

    var gsUtils = chrome.extension.getBackgroundPage().gsUtils;
    var tgs = chrome.extension.getBackgroundPage().tgs;

    var unsuspending = false;

    var updateSuspendedTabCount = function () {
        var suspendedTabCount = gsUtils.getSuspendedTabCount();
        if (suspendedTabCount > 0) {
            document.getElementById('suspendedTabCount').innerHTML =
                chrome.i18n.getMessage('js_update_suspended_count_prefix') + ' <strong>' + suspendedTabCount + '</strong> ' +
                chrome.i18n.getMessage('js_update_suspended_count_suffix');
            document.getElementById('unsuspendAllBtn').style = 'display: block';
        } else {
            document.getElementById('suspendedTabCount').innerHTML = chrome.i18n.getMessage('js_update_ready');
            document.getElementById('unsuspendAllBtn').style = 'display: none';
        }
        if (unsuspending) {
            document.getElementById('unsuspendAllBtn').classList.add('btnDisabled');
            document.getElementById('unsuspendAllBtn').innerHTML = "<i class='fa fa-spinner fa-spin '></i> " + chrome.i18n.getMessage('js_update_button_unsuspending_tabs');
        } else {
            document.getElementById('unsuspendAllBtn').classList.remove('btnDisabled');
            document.getElementById('unsuspendAllBtn').innerHTML = chrome.i18n.getMessage('js_update_button_unsuspend');
        }
        return suspendedTabCount;
    };

    gsUtils.documentReadyAndLocalisedAsPromsied(document).then(function () {

        document.getElementById('unsuspendAllBtn').onclick = function (e) {
            if (unsuspending) {
                return;
            }
            unsuspending = true;
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
            if (request.status === 'suspended') {
                unsuspending = false;
                updateSuspendedTabCount();
            }
            return false;

        case 'initTab':
            updateSuspendedTabCount();
            return false;
        }
    });
}());
