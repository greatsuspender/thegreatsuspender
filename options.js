/*global document, window, localStorage, chrome */

(function () {

    "use strict";

    // Saves options to localStorage.
    function save_options() {

        var whitelist = document.getElementById("whitelist").value,
            select = document.getElementById("timeToSuspend"),
            timeToSuspend = select.children[select.selectedIndex].value;

        localStorage.setItem("gsWhitelist", whitelist);
        localStorage.setItem("gsTimeToSuspend", timeToSuspend);
    }

    function selectComboBox(element, key) {
        var i,
            child;

        for (i = 0; i < element.children.length; i++) {
            child = element.children[i];
            if (child.value === key) {
                child.selected = "true";
                break;
            }
        }
    }

    // Restores select box state to saved value from localStorage.
    function restore_options() {

        var timeToSuspend = localStorage.getItem("gsTimeToSuspend") || 0,
            whitelist = localStorage.getItem("gsWhitelist") || "";

        document.getElementById("whitelist").value = whitelist;
        selectComboBox(document.getElementById("timeToSuspend"), timeToSuspend);
    }


    var readyStateCheckInterval = window.setInterval(function () {
        if (document.readyState === "complete") {

            window.clearInterval(readyStateCheckInterval);

            var saveEl = document.getElementById('save'),
                showHistoryEl = document.getElementById('showHistory'),
                clearHistoryEl = document.getElementById('clearHistory');

            saveEl.onclick = function (e) {
                save_options();
            };

            showHistoryEl.onclick = function (e) {
                chrome.tabs.create({url: chrome.extension.getURL("history.html")});
            };
            clearHistoryEl.onclick = function (e) {
                localStorage.setItem('gsHistory2', JSON.stringify([]));
            };

            restore_options();
        }
    }, 10);
}());