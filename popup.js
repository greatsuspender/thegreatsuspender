/*global document, chrome, window */

(function () {

    "use strict";

    document.addEventListener('DOMContentLoaded', function () {

        document.getElementById('suspendOne').addEventListener('click', function () {
            chrome.extension.sendRequest({ msg: "suspendOne" });
            window.close();
        });
        document.getElementById('suspendAll').addEventListener('click', function () {
            chrome.extension.sendRequest({ msg: "suspendAll" });
            window.close();
        });
        document.getElementById('unsuspendAll').addEventListener('click', function () {
            chrome.extension.sendRequest({ msg: "unsuspendAll" });
            window.close();
        });
        document.getElementById('settings').addEventListener('click', function () {
            chrome.tabs.create({
                url: chrome.extension.getURL("options.html")
            });
            window.close();
        });
    });
}());