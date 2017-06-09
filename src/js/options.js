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
            'autoSaveOptions': gsUtils.AUTO_SAVE,
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
        setSaveButtonVisibility(!gsUtils.getOption(gsUtils.AUTO_SAVE));
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
    
    function setSaveButtonVisibility(visible) {
        if (visible) {
            document.getElementById('saveBtn').style.display = 'block';
        } else {
            document.getElementById('saveBtn').style.display = 'none';
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
            }
            
            // Save option change if auto save is enabled        
            if (gsUtils.getOption(gsUtils.AUTO_SAVE) == true) {
                saveChange(element);
                // notify all option page instances of settings change
                chrome.extension.getBackgroundPage().tgs.notifyUpdateToOptionPages();
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
        if (pref === gsUtils.ADD_CONTEXT) {
            chrome.extension.getBackgroundPage().tgs.buildContextMenu(newValue);
        }
        
        if (pref === gsUtils.AUTO_SAVE) {
            setSaveButtonVisibility(!gsUtils.getOption(gsUtils.AUTO_SAVE));
        }
    }

    function closeSettings() {
        //only close the window if we were opened in a new tab.
        //else, go back to the page we were on.
        //this is to fix closing tabs if they were opened from the context menu.
        if (document.referrer === "") {
            window.close();
        } else {
            history.back();
        }
    }
    
    function saveOptions(optionEls) {
        for (var i = 0; i < optionEls.length; i++) {
            saveChange(optionEls[i]);
        }
        // Notify all option page instances of settings change
        chrome.extension.getBackgroundPage().tgs.notifyUpdateToOptionPages();
    }

    readyStateCheckInterval = window.setInterval(function () {
        if (document.readyState === 'complete') {

            window.clearInterval(readyStateCheckInterval);

            initialise();
            initSettings();
            
            // Add listener for option changes when multiple
            // instance of options page is open
            chrome.runtime.onMessage.addListener(
            function(request, sender, sendResponse) {
                if (request.command == "updateOptions") {
                    initSettings();
                }
            });

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
                saveOptions(optionEls);
                closeSettings();
            };
            cancelEl.onclick = function (e) {
                closeSettings();
            };
            window.onbeforeunload = function(e) { 
                if (!gsUtils.getOption(gsUtils.AUTO_SAVE)) {
                    var newVal, 
                        oldVal,
                        i;
                    
                    // Check if any options have changed and raise
                    // a dialog to notify user to click on save button
                    for (i = 0; i < optionEls.length; i++) {
                        newVal = getOptionValue(optionEls[i]);
                        oldVal = gsUtils.getOption(elementPrefMap[optionEls[i].id]);
                        if (newVal != oldVal) {
                            return "Settings have been modified. Press save button to retain the changes or enable auto save option.";
                        }
                    }
                }
            }
        }
    }, 50);
}());
