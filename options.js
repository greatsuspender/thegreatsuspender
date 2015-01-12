/*global gsUtils, chrome, invert, populateOption, setPreviewQualityVisibility, setTidyUrlVisibility, setOnlineCheckVisibility, resetTabTimers */

(function () {

    'use strict';

    var elementPrefMap = {
            'preview': gsUtils.SHOW_PREVIEW,
            'previewQuality': gsUtils.PREVIEW_QUALITY,
            'onlineCheck': gsUtils.ONLINE_CHECK,
            'unsuspendOnFocus': gsUtils.UNSUSPEND_ON_FOCUS,
            'dontSuspendPinned': gsUtils.IGNORE_PINNED,
            'dontSuspendForms': gsUtils.IGNORE_FORMS,
            'ignoreCache': gsUtils.IGNORE_CACHE,
            'timeToSuspend': gsUtils.SUSPEND_TIME,
            'whitelist': gsUtils.WHITELIST
        },
        elementIdMap = invert(elementPrefMap),
        readyStateCheckInterval;

    function invert(obj) {

        var new_obj = {},
            prop;

        for (prop in obj) {
            if (obj.hasOwnProperty(prop)) {
                new_obj[obj[prop]] = prop;
            }
        }
        return new_obj;
    }

    function selectComboBox(element, key) {
        var i,
            child;

        for (i = 0; i < element.children.length; i += 1) {
            child = element.children[i];
            if (child.value === key) {
                child.selected = 'true';
                break;
            }
        }
    }

    //populate settings from synced storage
    function init() {

        var optionEls = document.getElementsByClassName('option'),
            shortcutsEl = document.getElementById('keyboardShortcuts'),
            pref,
            element,
            command,
            i;

        for (i = 0; i < optionEls.length; i++) {
            element = optionEls[i];
            pref = elementPrefMap[element.id];
            populateOption(element, gsUtils.getOption(pref));
        }

        setPreviewQualityVisibility(gsUtils.getOption(gsUtils.SHOW_PREVIEW));
        setTidyUrlVisibility(gsUtils.getOption(gsUtils.TIDY_URLS));
        setOnlineCheckVisibility(gsUtils.getOption(gsUtils.SUSPEND_TIME) > 0);

        //populate keyboard shortcuts
        chrome.commands.getAll(function (commands) {
            commands.forEach(function (command) {
                if (command.name !== '_execute_browser_action') {
                    shortcutsEl.innerHTML += '<span>' + command.description + ': ' + command.shortcut + '</span><br />';
                }
            });
        });
    }

    function populateOption(element, value) {
        if (element.tagName === 'INPUT' && element.hasAttribute('type') && element.getAttribute('type') === 'checkbox') {
            element.checked = value;

        } else if (element.tagName === 'SELECT') {
            selectComboBox(element, value);

        } else if (element.tagName === 'TEXTAREA') {
            element.value = value;
        }
    }

    function getOptionValue(element) {
        // TODO switch statement?
        if (element.tagName === 'INPUT' && element.hasAttribute('type') && element.getAttribute('type') === 'checkbox') {
            return element.checked;
        }
        if (element.tagName === 'SELECT') {
            return element.children[element.selectedIndex].value;
        }
        if (element.tagName === 'TEXTAREA') {
            return element.value;
        }
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

    function getHandler(element) {
        return function () {
            var pref = elementPrefMap[element.id],
                interval;
            gsUtils.setOption(elementPrefMap[element.id], getOptionValue(element));

            //add specific screen element listeners
            if (pref === gsUtils.SHOW_PREVIEW) {
                setPreviewQualityVisibility(getOptionValue(element));

            } else if (pref === gsUtils.TIDY_URLS) {
                setTidyUrlVisibility(getOptionValue(element));

            } else if (pref === gsUtils.SUSPEND_TIME) {
                interval = getOptionValue(element);
                setOnlineCheckVisibility(interval > 0);
                resetTabTimers(interval);
            }
        };
    }

    readyStateCheckInterval = window.setInterval(function () {
        if (document.readyState === 'complete') {

            window.clearInterval(readyStateCheckInterval);

            init();


            var optionEls = document.getElementsByClassName('option'),
                configureShortcutsEl = document.getElementById('configureShortcuts'),
                element,
                i;

            //add change listeners for all 'option' elements
            for (i = 0; i < optionEls.length; i++) {
                element = optionEls[i];
                element.onchange = getHandler(element);
            }
            configureShortcutsEl.onclick = function (e) {
                chrome.tabs.update({url: 'chrome://extensions/configureCommands'});
            };

            chrome.storage.onChanged.addListener(function (changes, namespace) {
                var property,
                    elementId;

                if (namespace !== 'sync') { return; }
                for (property in changes) {
                    if (changes.hasOwnProperty(property)) {
                        elementId = elementIdMap[property];
                        element = document.getElementById(elementId);
                        populateOption(element, changes[property].newValue);
                    }
                }
            });
        }
    }, 50);


    //TODO: add a pref save button

    function resetTabTimers(newInterval) {

        chrome.tabs.query({}, function (tabs) {
            var currentTab,
                timeout = newInterval,
                tabId;

            tabs.forEach(function (currentTab) {
                tabId = currentTab.id;
                //test if a content script is active by sending a 'requestInfo' message
                chrome.tabs.sendMessage(tabId, {action: 'requestInfo'}, function (response) {
                    //if response, then request a timer reset
                    if (typeof(response) !== 'undefined') {
                        chrome.tabs.sendMessage(tabId, {
                            action: 'resetTimer',
                            timeout: timeout
                        });
                    }
                });
            });
        });
    }

}());
