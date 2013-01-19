/*global document, window, localStorage */

(function () {

    "use strict";

    // Saves options to localStorage.
    function save_options() {

        var preview = document.getElementById("preview"),
            select = document.getElementById("maxHeight"),
            maxHeight = select.children[select.selectedIndex].value;

    /*    var select = document.getElementById("format");
        var format = select.children[select.selectedIndex].value;
        window.localStorage.setItem("format", format);
        
        select = document.getElementById("quality");
        var quality = select.children[select.selectedIndex].value;
        window.localStorage.setItem("quality", quality);
    */

        window.localStorage.setItem("preview", preview.checked);
        window.localStorage.setItem("maxHeight", maxHeight);
        window.close();
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

    function enablePreviewComponents(visible) {

        if (visible) {
            //document.getElementById('format').removeAttribute("class", "hidden");
            document.getElementById('maxHeight').removeAttribute("class", "hidden");
            //document.getElementById('formatLbl').removeAttribute("class", "hidden");
            document.getElementById('maxHeightLbl').removeAttribute("class", "hidden");
        } else {
            //document.getElementById('format').setAttribute("class", "hidden");
            document.getElementById('maxHeight').setAttribute("class", "hidden");
            //document.getElementById('formatLbl').setAttribute("class", "hidden");
            document.getElementById('maxHeightLbl').setAttribute("class", "hidden");
        }
    }

    // Restores select box state to saved value from localStorage.
    function restore_options() {

        var preview = window.localStorage.getItem("preview") ? window.localStorage.getItem("preview") === "true" : true,
            maxHeight = window.localStorage.getItem("maxHeight") || 2;
    /*    
        var format = localStorage.getItem("format") || "image/png"; 
        var quality = localStorage.getItem("quality") || 0.4; 
    */

        document.getElementById("preview").checked = preview;
        //selectComboBox(document.getElementById("format"), format);
        //selectComboBox(document.getElementById("quality"), quality);
        selectComboBox(document.getElementById("maxHeight"), maxHeight);

        enablePreviewComponents(preview);
        //enableQualityComponent(preview && format === "image/jpeg");
    }

    /*function enableQualityComponent(visible) {
        
        if (visible) {
            document.getElementById('quality').removeAttribute("class", "hidden");
            document.getElementById('qualityLbl').removeAttribute("class", "hidden");
        } else {
            document.getElementById('quality').setAttribute("class", "hidden");
            document.getElementById('qualityLbl').setAttribute("class", "hidden");
        }
    }
    */

    var readyStateCheckInterval = window.setInterval(function () {
        if (document.readyState === "complete") {

            window.clearInterval(readyStateCheckInterval);

            var previewEl = document.getElementById('preview'),
                saveEl = document.getElementById('save'),
                showHistoryEl = document.getElementById('showHistory'),
                clearHistoryEl = document.getElementById('clearHistory');

            //var formatEl = document.getElementById('format');

            previewEl.onclick = function (e) {
                enablePreviewComponents(this.checked);
                //enableQualityComponent(this.checked && formatEl.children[formatEl.selectedIndex].value === "image/jpeg");
            };
            /*formatEl.onclick = function (e) {
                enableQualityComponent(this.children[this.selectedIndex].value === "image/jpeg");
            };*/
            saveEl.onclick = function (e) {
                save_options();
            };

            showHistoryEl.onclick = function (e) {
                chrome.tabs.create({url: chrome.extension.getURL("suspended.html")});
            };
            clearHistoryEl.onclick = function (e) {
                localStorage.setItem("gsHistory", []);
            };

            restore_options();
        }
    }, 10);
}());