/*global window, document, chrome, console, localStorage */

(function(window) {

    'use strict';

    var gsStorage = {

        fetchPreviewImage: function(tabUrl, callback) {
            chrome.storage.local.get(null, function(items) {
                if (typeof (items.gsPreviews) === 'undefined') {
                    items.gsPreviews = {};
                    chrome.storage.local.set(items);
                    callback(null);

                } else if (typeof (items.gsPreviews[tabUrl]) === 'undefined') {
                    callback(null);

                } else {
                    callback(items.gsPreviews[tabUrl]);
                }
            });
        },

        setPreviewImage: function(tabUrl, previewUrl) {
            chrome.storage.local.get(null, function(items) {

                if (typeof (items.gsPreviews) === 'undefined') {
                    items.gsPreviews = {};
                }
                items.gsPreviews[tabUrl] = previewUrl;
                chrome.storage.local.set(items);
            });
        },

        clearPreviews: function() {
            chrome.storage.local.get(null, function(items) {
                items.gsPreviews = {};
                chrome.storage.local.set(items);
            });
        },

        fetchPreviewOption: function() {
            return localStorage.getItem('preview') ? localStorage.getItem('preview') === 'true' : false;
        },

        setPreviewOption: function(preview) {
            localStorage.setItem('preview', preview);
        },

        fetchPreviewQualityOption: function() {
            return localStorage.getItem('previewQuality') ? localStorage.getItem('previewQuality') === 'true' : false;
        },

        setPreviewQualityOption: function(preview) {
            localStorage.setItem('previewQuality', preview);
        },

        fetchTimeToSuspendOption: function() {
            return localStorage.getItem('gsTimeToSuspend') || 0;
        },

        setTimeToSuspendOption: function(timeToSuspend) {
            localStorage.setItem('gsTimeToSuspend', timeToSuspend);
        },

        fetchUnsuspendOnFocusOption: function() {
            return localStorage.getItem('gsUnsuspendOnFocus') ? localStorage.getItem('gsUnsuspendOnFocus') === 'true' : false;
        },

        setUnsuspendOnFocusOption: function(unsuspendOnFocus) {
            localStorage.setItem('gsUnsuspendOnFocus', unsuspendOnFocus);
        },

        fetchDontSuspendPinnedOption: function() {
            return localStorage.getItem('gsDontSuspendPinned') ? localStorage.getItem('gsDontSuspendPinned') === 'true' : false;
        },

        setDontSuspendPinnedOption: function(dontSuspendPinned) {
            localStorage.setItem('gsDontSuspendPinned', dontSuspendPinned);
        },

        fetchDontSuspendFormsOption: function() {
            return localStorage.getItem('gsDontSuspendForms') ? localStorage.getItem('gsDontSuspendForms') === 'true' : false;
        },

        setDontSuspendFormsOption: function(dontSuspendForms) {
            localStorage.setItem('gsDontSuspendForms', dontSuspendForms);
        },

        fetchVersion: function() {
            return localStorage.getItem('gsVersion');
        },

        setVersion: function(newVersion) {
            localStorage.setItem('gsVersion', newVersion);
        },

        fetchWhitelist: function() {
            return localStorage.getItem('gsWhitelist') || '';
        },

        setWhitelist: function(whitelist) {
            localStorage.setItem('gsWhitelist', whitelist);
        },

        saveToWhitelist: function(newString) {
            var whitelist = localStorage.getItem('gsWhitelist') || '';
            localStorage.setItem('gsWhitelist', whitelist + ' ' + newString);
        },

        fetchOldGsHistory: function() {

            var result = localStorage.getItem('gsHistory');
            if (result !== null) {
                result = JSON.parse(result);
            }
            return result;
        },

        removeOldGsHistory: function() {
            localStorage.removeItem('gsHistory');
        },

        fetchGsHistory: function() {

            var result = localStorage.getItem('gsHistory2');
            if (result === null) {
                result = [];
            } else {
                result = JSON.parse(result);
            }
            return result;
        },

        setGsHistory: function(gsHistory) {
            localStorage.setItem('gsHistory2', JSON.stringify(gsHistory));
        },

        clearGsHistory: function(gsHistory) {
            this.setGsHistory([]);
        },

        fetchTabFromHistory: function(tabUrl) {

            var gsHistory = this.fetchGsHistory(),
                i;

            for (i = 0; i < gsHistory.length; i++) {
                if (gsHistory[i].url === tabUrl) {
                    return gsHistory[i];
                }
            }
            return false;
        },

        saveTabToHistory: function(tabUrl, tabProperties) {

            var gsHistory = this.fetchGsHistory(),
                i;

            for (i = 0; i < gsHistory.length; i++) {
                if (gsHistory[i].url === tabUrl) {
                    gsHistory[i] = tabProperties;
                    //break; dont break anymore. want to update them all.
                }
            }
            localStorage.setItem('gsHistory2', JSON.stringify(gsHistory));
        },

        fetchGsSessionHistory: function() {

            var result = localStorage.getItem('gsSessionHistory');
            if (result === null) {
                result = [];
            } else {
                result = JSON.parse(result);
            }
            return result;
        },

        saveWindowsToSessionHistory: function(sessionId, windowsArray) {

            var gsSessionHistory = this.fetchGsSessionHistory(),
                i,
                match = false;

            for (i = 0; i < gsSessionHistory.length; i++) {
                if (gsSessionHistory[i].id === sessionId) {
                    gsSessionHistory[i].windows = windowsArray;
                    match = true;
                    break;
                }
            }

            //if no matching window id found. create a new entry
            if (!match) {
                gsSessionHistory.unshift({id: sessionId, windows: windowsArray});
            }

            //trim stored windows down to last 3
            while (gsSessionHistory.length > 3) {
                gsSessionHistory.splice(gsSessionHistory.length - 1, 1);
            }

            localStorage.setItem('gsSessionHistory', JSON.stringify(gsSessionHistory));
        },

        generateSuspendedUrl: function(tabUrl) {
            return chrome.extension.getURL('suspended.html' + '#url=' + encodeURIComponent(tabUrl));
        },

        getHashVariable: function(key, hash) {

            var parts,
                temp,
                i;

            if (hash.length === 0) {
                return false;
            }

            parts = hash.substring(1).split('&');
            for (i = 0; i < parts.length; i++) {
                temp = parts[i].split('=');
                if (temp[0] === key) {
                    return decodeURIComponent(temp[1]);
                }
            }
            return false;
        }

    };
    window.gsStorage = gsStorage;

}(window));
