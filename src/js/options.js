/*global gsUtils, chrome, invert, populateOption, setScreenCaptureNoteVisibility, setOnlineCheckVisibility, setAudibleNoteVisibility, resetTabTimers */

(function () {

    'use strict';

    var gsUtils,
        elementPrefMap,
        elementIdMap,
        readyStateCheckInterval;

    function initialise() {

        gsUtils = chrome.extension.getBackgroundPage().gsUtils;
        elementPrefMap = {
            'preview': gsUtils.SCREEN_CAPTURE,
            'onlineCheck': gsUtils.ONLINE_CHECK,
            'batteryCheck': gsUtils.BATTERY_CHECK,
            'unsuspendOnFocus': gsUtils.UNSUSPEND_ON_FOCUS,
            'dontSuspendPinned': gsUtils.IGNORE_PINNED,
            'dontSuspendForms': gsUtils.IGNORE_FORMS,
            'dontSuspendAudio': gsUtils.IGNORE_AUDIO,
            'ignoreCache': gsUtils.IGNORE_CACHE,
            'addContextMenu': gsUtils.ADD_CONTEXT,
            'syncSettings': gsUtils.SYNC_SETTINGS,
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

        setScreenCaptureNoteVisibility(gsUtils.getOption(gsUtils.SCREEN_CAPTURE) !== '0');
        setAudibleNoteVisibility(gsUtils.getChromeVersion() < 45 && gsUtils.getOption(gsUtils.IGNORE_AUDIO));
        setAutoSuspendOptionsVisibility(gsUtils.getOption(gsUtils.SUSPEND_TIME) > 0);
        setSyncNoteVisibility(!gsUtils.getOption(gsUtils.SYNC_SETTINGS));
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

    function setAudibleNoteVisibility(visible) {
        if (visible) {
            document.getElementById('audibleOptionNote').style.display = 'block';
        } else {
            document.getElementById('audibleOptionNote').style.display = 'none';
        }
    }

  function setScreenCaptureNoteVisibility(visible) {
    if (visible) {
      document.getElementById('previewNote').style.display = 'block';
    } else {
      document.getElementById('previewNote').style.display = 'none';
    }
  }

  function setSyncNoteVisibility(visible) {
    if (visible) {
      document.getElementById('syncNote').style.display = 'block';
    } else {
      document.getElementById('syncNote').style.display = 'none';
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
                interval,
                chromeVersion;

            //add specific screen element listeners
            if (pref === gsUtils.SCREEN_CAPTURE) {
                setScreenCaptureNoteVisibility(getOptionValue(element) !== '0');

            } else if (pref === gsUtils.IGNORE_AUDIO) {
                chromeVersion = gsUtils.getChromeVersion();
                setAudibleNoteVisibility(chromeVersion < 45 && getOptionValue(element));

            } else if (pref === gsUtils.SUSPEND_TIME) {
                interval = getOptionValue(element);
                setAutoSuspendOptionsVisibility(interval > 0);

            } else if (pref === gsUtils.SYNC_SETTINGS) {
                setSyncNoteVisibility(!getOptionValue(element));
            }
        };
    }

    function saveChange(element, updatedPreferences) {

        var pref = elementPrefMap[element.id],
            oldValue = gsUtils.getOption(pref),
            newValue = getOptionValue(element);

        //clean up whitelist before saving
        if (pref === gsUtils.WHITELIST) {
            newValue = gsUtils.cleanupWhitelist(newValue);
        }

        //save option
        gsUtils.setOption(elementPrefMap[element.id], newValue);

        if (oldValue !== newValue) {
            updatedPreferences.push(pref);
        }
    }

    function performPostSaveUpdates(updatedPreferences) {

        //if interval has changed then reset the tab timers
        if (contains(updatedPreferences, gsUtils.SUSPEND_TIME)) {
            chrome.extension.getBackgroundPage().tgs.resetAllTabTimers();
        }

        //if context menu has been disabled then remove from chrome
        if (contains(updatedPreferences, gsUtils.ADD_CONTEXT)) {
            var addContextMenu = gsUtils.getOption(gsUtils.ADD_CONTEXT);
            chrome.extension.getBackgroundPage().tgs.buildContextMenu(addContextMenu);
        }

        //if theme or preview settings have changed then refresh all suspended pages
        if (contains(updatedPreferences, gsUtils.THEME) ||
                contains(updatedPreferences, gsUtils.SCREEN_CAPTURE)) {
            chrome.extension.getBackgroundPage().tgs.resuspendAllSuspendedTabs();
        }
    }

    function contains(array, value) {
        for (var i = 0; i < array.length; i++) {
            if (array[i] == value) return true;
        }
        return false;
    }

    function closeSettings() {
        //only close the window if we were opened in a new tab.
        //else, go back to the page we were on.
        //this is to fix closing tabs if they were opened from the context menu.
        if (window.history.length > 1) {
            history.back();
        } else {
            window.close();
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
                var updatedPreferences = [];
                for (i = 0; i < optionEls.length; i++) {
                    saveChange(optionEls[i], updatedPreferences);
                }

                // Push out all our saved settings to sync storage.
                gsUtils.syncSettings();

                performPostSaveUpdates(updatedPreferences);
                closeSettings();
            };
            cancelEl.onclick = function (e) {
                closeSettings();
            };
        }
    }, 50);
}());
