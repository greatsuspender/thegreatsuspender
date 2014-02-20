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

                    /*chrome.tabs.getCurrent(function(tab) {
                        chrome.extension.getBackgroundPage().tgs.setFormInputState(tab.id);
                    });*/
                    //chrome.extension.getBackgroundPage().tgs.setFormInputState();

console.log('sending new message: setFormInputState');
                    chrome.runtime.sendMessage({ action: 'setFormInputState' });
                }
            }
        }
    });
}());
