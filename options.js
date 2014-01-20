/*global document, window, gsStorage, chrome */

(function() {

    'use strict';

    function selectComboBox(element, key) {
        var i,
            child;

        for (i = 0; i < element.children.length; i++) {
            child = element.children[i];
            if (child.value === key) {
                child.selected = 'true';
                break;
            }
        }
    }

    // Restores select box state to saved value from localStorage.
    function restore_options() {

        var preview = gsStorage.fetchPreviewOption(),
            previewQuality = gsStorage.fetchPreviewQualityOption(),
            unsuspendOnFocus = gsStorage.fetchUnsuspendOnFocusOption(),
            dontSuspendPinned = gsStorage.fetchDontSuspendPinnedOption(),
            timeToSuspend = gsStorage.fetchTimeToSuspendOption(),
            whitelist = gsStorage.fetchWhitelist();

        document.getElementById('preview').checked = preview;
        document.getElementById('previewQuality').checked = previewQuality;
        document.getElementById('unsuspendOnFocus').checked = unsuspendOnFocus;
        document.getElementById('dontSuspendPinned').checked = dontSuspendPinned;
        document.getElementById('whitelist').value = whitelist;
        selectComboBox(document.getElementById('timeToSuspend'), timeToSuspend);
        setPreviewQualityVisibility(preview);

    }

    function setPreviewQualityVisibility(visible) {
        if (visible) {
            document.getElementById('previewQualitySection').style.display = 'block';
        } else {
            document.getElementById('previewQualitySection').style.display = 'none';
        }
    }


    var readyStateCheckInterval = window.setInterval(function() {
        if (document.readyState === 'complete') {

            window.clearInterval(readyStateCheckInterval);

            var previewEl = document.getElementById('preview'),
                qualityEl = document.getElementById('previewQuality'),
                unsuspendOnFocusEl = document.getElementById('unsuspendOnFocus'),
                dontSuspendPinnedEl = document.getElementById('dontSuspendPinned'),
                whitelistEl = document.getElementById('whitelist'),
                timeToSuspendEl = document.getElementById('timeToSuspend'),
                showHistoryEl = document.getElementById('showHistory'),
                clearHistoryEl = document.getElementById('clearHistory');

            previewEl.onclick = function(e) {
                gsStorage.setPreviewOption(previewEl.checked);
                setPreviewQualityVisibility(previewEl.checked);
            };
            qualityEl.onclick = function(e) {
                gsStorage.setPreviewQualityOption(qualityEl.checked);
            };
            unsuspendOnFocusEl.onclick = function(e) {
                gsStorage.setUnsuspendOnFocusOption(unsuspendOnFocusEl.checked);
            };
            dontSuspendPinnedEl.onclick = function(e) {
                var val = dontSuspendPinnedEl.checked;
                console.log('Dont suspent pinned changed to: ' + val);
                gsStorage.setDontSuspendPinnedOption(val);
            };
            whitelistEl.onkeyup = function(e) {
                gsStorage.setWhitelist(whitelistEl.value);
            };
            timeToSuspendEl.onchange = function(e) {
                gsStorage.setTimeToSuspendOption(timeToSuspendEl.children[timeToSuspendEl.selectedIndex].value);
            };
            showHistoryEl.onclick = function(e) {
                chrome.tabs.create({url: chrome.extension.getURL('history.html')});
            };
            clearHistoryEl.onclick = function(e) {
                gsStorage.clearGsHistory();
                gsStorage.clearPreviews();
            };

            restore_options();
        }
    }, 10);
}());
