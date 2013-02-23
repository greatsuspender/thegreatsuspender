/*global window, document, chrome, console, localStorage */

(function (window) {

    "use strict";

    var gsStorage = {

        fetchPreviewImage : function (tabUrl, callback) {
            chrome.storage.local.get(null, function (items) {
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

        setPreviewImage : function (tabUrl, previewUrl) {
            chrome.storage.local.get(null, function (items) {

                if (typeof (items.gsPreviews) === 'undefined') {
                    items.gsPreviews = {};
                }
                items.gsPreviews[tabUrl] = previewUrl;
                chrome.storage.local.set(items);
            });
        },

        clearPreviews : function () {
            chrome.storage.local.get(null, function (items) {
                items.gsPreviews = {};
                chrome.storage.local.set(items);
            });
        },

        fetchPreviewOption : function () {
            return localStorage.getItem("preview") ? localStorage.getItem("preview") === "true" : false;
        },

        setPreviewOption : function (preview) {
            localStorage.setItem("preview", preview);
        },

        fetchTimeToSuspendOption : function () {
            return localStorage.getItem("gsTimeToSuspend") || 0;
        },

        setTimeToSuspendOption : function (timeToSuspend) {
            localStorage.setItem("gsTimeToSuspend", timeToSuspend);
        },

        fetchUnsuspendOnFocusOption : function () {
            return localStorage.getItem("gsUnsuspendOnFocus") ? localStorage.getItem("gsUnsuspendOnFocus") === "true" : false;
        },

        setUnsuspendOnFocusOption : function (unsuspendOnFocus) {
            localStorage.setItem("gsUnsuspendOnFocus", unsuspendOnFocus);
        },

        fetchVersion : function () {
            return localStorage.getItem('gsVersion');
        },

        setVersion : function (newVersion) {
            localStorage.setItem('gsVersion', newVersion);
        },

        fetchWhitelist : function () {
            return localStorage.getItem('gsWhitelist') || "";
        },

        setWhitelist : function (whitelist) {
            localStorage.setItem("gsWhitelist", whitelist);
        },

        saveToWhitelist : function (newString) {
            var whitelist = localStorage.getItem("gsWhitelist") || "";
            localStorage.setItem("gsWhitelist", whitelist + " " + newString);
        },

        fetchOldGsHistory : function () {

            var result = localStorage.getItem('gsHistory');
            if (result !== null) {
                result = JSON.parse(result);
            }
            return result;
        },

        removeOldGsHistory : function () {
            localStorage.removeItem('gsHistory');
        },

        fetchGsHistory : function () {

            var result = localStorage.getItem('gsHistory2');
            if (result === null) {
                result = [];
            } else {
                result = JSON.parse(result);
            }
            return result;
        },

        setGsHistory : function (gsHistory) {
            localStorage.setItem('gsHistory2', JSON.stringify(gsHistory));
        },

        clearGsHistory : function (gsHistory) {
            this.setGsHistory([]);
        },

        fetchTabFromHistory : function (tabUrl) {

            var gsHistory = this.fetchGsHistory(),
                i;

            for (i = 0; i < gsHistory.length; i++) {
                if (gsHistory[i].url === tabUrl) {
                    return gsHistory[i];
                }
            }
            return false;
        },

        saveTabToHistory : function (tabUrl, tabProperties) {

            var gsHistory = this.fetchGsHistory(),
                i;

            for (i = 0; i < gsHistory.length; i++) {
                if (gsHistory[i].url === tabUrl) {
                    gsHistory[i] = tabProperties;
                    localStorage.setItem('gsHistory2', JSON.stringify(gsHistory));
                    //break; dont break anymore. want to update them all.
                }
            }
        },

        generateSuspendedUrl : function (tabUrl) {
            return chrome.extension.getURL("suspended.html" + "#url=" + encodeURIComponent(tabUrl));
        }

    };
    window.gsStorage = gsStorage;

}(window));