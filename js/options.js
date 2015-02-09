/*global gsUtils, chrome, invert, populateOption, setPreviewQualityVisibility, setOnlineCheckVisibility, resetTabTimers */

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
        setOnlineCheckVisibility(gsUtils.getOption(gsUtils.SUSPEND_TIME) > 0);
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

    function handleChange(element) {
        return function () {
            var pref = elementPrefMap[element.id],
                interval;

            //add specific screen element listeners
            if (pref === gsUtils.SHOW_PREVIEW) {
                setPreviewQualityVisibility(getOptionValue(element));

            } else if (pref === gsUtils.SUSPEND_TIME) {
                interval = getOptionValue(element);
                setOnlineCheckVisibility(interval > 0);
            }
        };
    }

    function saveChange(element) {

        var pref = elementPrefMap[element.id],
            interval;

        //save option
        gsUtils.setOption(elementPrefMap[element.id], getOptionValue(element));

        //if interval has changed then reset the tab timers
        if (pref === gsUtils.SUSPEND_TIME) {
            interval = getOptionValue(element);
            resetTabTimers(interval);
        }
    }

    readyStateCheckInterval = window.setInterval(function () {
        if (document.readyState === 'complete') {

            window.clearInterval(readyStateCheckInterval);

            init();

            var optionEls = document.getElementsByClassName('option'),
                saveEl = document.getElementById('saveBtn'),
                cancelEl = document.getElementById('cancelBtn'),
                element,
                i;

            //add change listeners for all 'option' elements
            for (i = 0; i < optionEls.length; i++) {
                element = optionEls[i];
                element.onchange = handleChange(element);
            }
            saveEl.onclick = function (e) {
                for (i = 0; i < optionEls.length; i++) {
                    saveChange(optionEls[i]);
                }
                chrome.tabs.getCurrent(function(t) {chrome.tabs.remove(t.id);});
            };
            cancelEl.onclick = function (e) {
                chrome.tabs.getCurrent(function(t) {chrome.tabs.remove(t.id);});
            };
        }
    }, 50);

    function resetTabTimers(timeout) {

        chrome.tabs.query({}, function (tabs) {
            tabs.forEach(function (currentTab) {
                requestTabReset(currentTab.id, timeout)
            });
        });
    }

    function requestTabReset(tabId, timeout) {
        //test if a content script is active by sending a 'requestInfo' message
        chrome.tabs.sendMessage(tabId, {action: 'requestInfo'}, function (response) {
            //if response, then request a timer reset
            if (typeof(response) !== 'undefined') {
                chrome.tabs.sendMessage(tabId, {
                    action: 'resetTimer',
                    suspendTime: timeout
                });
            }
        });
    }

}());
