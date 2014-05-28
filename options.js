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
            dontSuspendForms = gsStorage.fetchDontSuspendFormsOption(),
            timeToSuspend = gsStorage.fetchTimeToSuspendOption(),
            onlineCheck = gsStorage.fetchOnlineCheckOption(),
            //ignoreCache = gsStorage.fetchIgnoreCacheOption(),
            maxHistories = gsStorage.fetchMaxHistoriesOption(),
            whitelist = gsStorage.fetchWhitelist();

        document.getElementById('preview').checked = preview;
        document.getElementById('previewQuality').checked = previewQuality;
        document.getElementById('onlineCheck').checked = onlineCheck;
        document.getElementById('unsuspendOnFocus').checked = unsuspendOnFocus;
        document.getElementById('dontSuspendPinned').checked = dontSuspendPinned;
        document.getElementById('dontSuspendForms').checked = dontSuspendForms;
        //document.getElementById('ignoreCache').checked = ignoreCache;
        //document.getElementById('maxHistories').value = maxHistories;
        //document.getElementById('whitelist').value = whitelist;
        selectComboBox(document.getElementById('timeToSuspend'), timeToSuspend);
        setPreviewQualityVisibility(preview);
        setOnlineCheckVisibility(timeToSuspend > 0);

        gsStorage.fetchSynchedWhitelist(function(whitelist) {
            document.getElementById('whitelist').value = whitelist;
        });

    }

    function setPreviewQualityVisibility(visible) {
        if (visible) {
            document.getElementById('previewQualitySection').style.display = 'block';
            document.getElementById('previewQualityNote').style.display = 'block';
        } else {
            document.getElementById('previewQualitySection').style.display = 'none';
            document.getElementById('previewQualityNote').style.display = 'none';
        }
    }

    function setOnlineCheckVisibility(visible) {
        if (visible) {
            document.getElementById('onlineCheckSection').style.display = 'block';
        } else {
            document.getElementById('onlineCheckSection').style.display = 'none';
        }
    }


    var readyStateCheckInterval = window.setInterval(function() {
        if (document.readyState === 'complete') {

            window.clearInterval(readyStateCheckInterval);

            var previewEl = document.getElementById('preview'),
                qualityEl = document.getElementById('previewQuality'),
                onlineCheckEl = document.getElementById('onlineCheck'),
                unsuspendOnFocusEl = document.getElementById('unsuspendOnFocus'),
                dontSuspendPinnedEl = document.getElementById('dontSuspendPinned'),
                dontSuspendFormsEl = document.getElementById('dontSuspendForms'),
                //ignoreCacheEl = document.getElementById('ignoreCache'),
                maxHistoriesEl = document.getElementById('maxHistories'),
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
            /*ignoreCacheEl.onclick = function(e) {
                gsStorage.setIgnoreCacheOption(ignoreCacheEl.checked);
            };*/
            dontSuspendPinnedEl.onclick = function(e) {
                var val = dontSuspendPinnedEl.checked;
                gsStorage.setDontSuspendPinnedOption(val);
            };
            dontSuspendFormsEl.onclick = function(e) {
                var val = dontSuspendFormsEl.checked;
                gsStorage.setDontSuspendFormsOption(val);
            };
            whitelistEl.onkeyup = function(e) {
                gsStorage.setWhitelist(whitelistEl.value);
            };
            timeToSuspendEl.onchange = function(e) {
                var timeToSuspend = timeToSuspendEl.children[timeToSuspendEl.selectedIndex].value;
                gsStorage.setTimeToSuspendOption(timeToSuspend);
                setOnlineCheckVisibility(timeToSuspend > 0);
            };
            onlineCheckEl.onclick = function(e) {
                gsStorage.setOnlineCheckOption(onlineCheckEl.checked);
            };
            /*maxHistoriesEl.onchange = function(e) {
                gsStorage.setMaxHistoriesOption(maxHistoriesEl.value);
            };*/
            showHistoryEl.onclick = function(e) {
                chrome.tabs.create({url: chrome.extension.getURL('history.html')});
            };
            clearHistoryEl.onclick = function(e) {
                gsStorage.clearGsSessionHistory();
                gsStorage.clearGsHistory();
                gsStorage.clearPreviews();
            };

            restore_options();


            chrome.storage.onChanged.addListener(function(changes, namespace) {
                if (namespace !== 'sync') return;
                for (var property in changes) {
                    if (changes.hasOwnProperty(property) && property === 'gsWhitelist') {
                        document.getElementById('whitelist').value = changes.gsWhitelist.newValue;
                    }
                }
            });
        }
    }, 10);


    //TODO: add a pref save button
    //if suspend interval changes then reset timers in open tabs
    //chrome.tabs.sendMessage(208, {action: 'resetTimer', timeout: 1000});

}());
