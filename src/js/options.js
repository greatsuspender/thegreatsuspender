/*global gsUtils, chrome, invert, populateOption, setPreviewQualityVisibility, setOnlineCheckVisibility, resetTabTimers */

(function () {

    'use strict';

    var gsUtils,
        elementPrefMap,
        elementIdMap,
        readyStateCheckInterval;

    function initialise() {

        gsUtils = chrome.extension.getBackgroundPage().gsUtils;
        elementPrefMap = {
            'preview': gsUtils.SHOW_PREVIEW,
            'previewQuality': gsUtils.PREVIEW_QUALITY,
            'onlineCheck': gsUtils.ONLINE_CHECK,
            'batteryCheck': gsUtils.BATTERY_CHECK,
            'unsuspendOnFocus': gsUtils.UNSUSPEND_ON_FOCUS,
            'dontSuspendPinned': gsUtils.IGNORE_PINNED,
            'dontSuspendForms': gsUtils.IGNORE_FORMS,
            'ignoreCache': gsUtils.IGNORE_CACHE,
            'addContextMenu': gsUtils.ADD_CONTEXT,
            'timeToSuspend': gsUtils.SUSPEND_TIME,
            'theme': gsUtils.THEME,
            'whitelist': gsUtils.WHITELIST
        };
        elementIdMap = invert(elementPrefMap);
    }

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
    function initSettings() {

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
        setAutoSuspendOptionsVisibility(gsUtils.getOption(gsUtils.SUSPEND_TIME) > 0);
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

    function setAutoSuspendOptionsVisibility(visible) {
        Array.prototype.forEach.call(document.getElementsByClassName('autoSuspendOption'), function(el) {
            if (visible) {
                el.style.display = 'block';
            } else {
                el.style.display = 'none';
            }
        });
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
                setAutoSuspendOptionsVisibility(interval > 0);
            }
        };
    }

    function saveChange(element) {

        var pref = elementPrefMap[element.id],
            oldValue = gsUtils.getOption(pref),
            newValue = getOptionValue(element);

        //clean up whitelist before saving
        if (pref === gsUtils.WHITELIST) {
            newValue = gsUtils.cleanupWhitelist(newValue);
        }

        //save option
        gsUtils.setOption(elementPrefMap[element.id], newValue);


        //if interval has changed then reset the tab timers
        if (pref === gsUtils.SUSPEND_TIME && oldValue !== newValue) {
            chrome.extension.getBackgroundPage().tgs.resetAllTabTimers();
        }

        //if context menu has been disabled then remove from chrome
        if (pref === gsUtils.ADD_CONTEXT && oldValue !== newValue) {
            if (newValue === true) {
                chrome.extension.getBackgroundPage().tgs.buildContextMenu();
            } else {
                chrome.extension.getBackgroundPage().tgs.removeContextMenu();
            }
        }
    }

    readyStateCheckInterval = window.setInterval(function () {
        if (document.readyState === 'complete') {

            window.clearInterval(readyStateCheckInterval);

            initialise();
            initSettings();

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
                window.close();
            };
            cancelEl.onclick = function (e) {
                window.close();
            };
        }
    }, 50);

}());
