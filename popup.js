/*global document, chrome, window */

(function() {

    'use strict';

    document.addEventListener('DOMContentLoaded', function() {

        document.getElementById('suspendOne').addEventListener('click', function() {
console.log('sending new message: suspendOne');
            chrome.runtime.sendMessage({ action: 'suspendOne' });
            window.close();
        });
        document.getElementById('suspendAll').addEventListener('click', function() {
console.log('sending new message: suspendAll');
            chrome.runtime.sendMessage({ action: 'suspendAll' });
            window.close();
        });
        document.getElementById('unsuspendAll').addEventListener('click', function() {
console.log('sending new message: unsuspendAll');
            chrome.runtime.sendMessage({ action: 'unsuspendAll' });
            window.close();
        });
        document.getElementById('settings').addEventListener('click', function() {
            chrome.tabs.create({
                url: chrome.extension.getURL('options.html')
            });
            window.close();
        });
    });
}());
