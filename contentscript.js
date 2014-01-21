/*global chrome, document, window, console, html2canvas */

(function() {

    'use strict';

    var inputState = false;

    //keylistener to check for form input
    window.addEventListener('keydown', function(event) {
        if (!inputState) {
            if (event.keyCode >= 48 && event.keyCode <= 90) {
                inputState = true;
                chrome.runtime.sendMessage({ action: 'setFormInputState' }, function(response) {});
            }
        }
    });


}());
