/*global chrome, document, window, console, html2canvas */

(function() {

    'use strict';

    var inputState = false;

    //keylistener to check for form input
    window.addEventListener('keydown', function(event) {
        if (!inputState) {
            if (event.keyCode >= 48 && event.keyCode <= 90 && event.target.tagName) {
                if (event.target.tagName.toUpperCase() == 'INPUT' ||
                        event.target.tagName.toUpperCase() == 'TEXTAREA' ||
                        event.target.tagName.toUpperCase() == 'FORM') {
                    inputState = true;

                    chrome.runtime.sendMessage({ action: 'setFormInputState' });
                }
            }
        }
    });
}());
