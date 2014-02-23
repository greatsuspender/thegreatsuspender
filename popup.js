/*global document, chrome, window */

(function() {

    'use strict';

    document.addEventListener('DOMContentLoaded', function() {

        document.getElementById('whitelist').addEventListener('click', function() {
            chrome.runtime.sendMessage({ action: 'whitelist' });
            window.close();
        });
        document.getElementById('suspendOne').addEventListener('click', function() {
            chrome.runtime.sendMessage({ action: 'suspendOne' });
            window.close();
        });
        document.getElementById('suspendAll').addEventListener('click', function() {
            chrome.runtime.sendMessage({ action: 'suspendAll' });
            window.close();
        });
        document.getElementById('unsuspendAll').addEventListener('click', function() {
            chrome.runtime.sendMessage({ action: 'unsuspendAll' });
            window.close();
        });
        document.getElementById('settings').addEventListener('click', function() {
            chrome.tabs.create({
                url: chrome.extension.getURL('options.html')
            });
            window.close();
        });

        chrome.windows.getLastFocused({populate: true}, function suspendHighlightedTab(window) {

            chrome.tabs.query({windowId: window.id, highlighted: true}, function(tabs) {

                if (tabs.length > 0) {
                    var tab = tabs[0];
                    if (chrome.extension.getBackgroundPage().tgs.checkWhiteList(tab.url)) {
                        document.getElementById('formInput').style.display = 'none';
                        document.getElementById('whitelisted').style.display = 'block';
                        document.getElementById('whitelist').style.display = 'none';

                    } else if (chrome.extension.getBackgroundPage().tgs.isTempWhitelisted(tab)) {
                        document.getElementById('formInput').style.display = 'block';
                        document.getElementById('whitelisted').style.display = 'none';
                        document.getElementById('whitelist').style.display = 'block';

                    } else {
                        document.getElementById('formInput').style.display = 'none';
                        document.getElementById('whitelist').style.display = 'block';
                        document.getElementById('whitelisted').style.display = 'none';
                    }
                }
            });
        });
    });

}());
