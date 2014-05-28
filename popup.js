/*global document, chrome, window */

(function() {

    'use strict';

    function showStatusBar(divId) {

        document.getElementById('formInput').style.display = 'none';
        document.getElementById('whitelisted').style.display = 'none';
        document.getElementById('pinnedTab').style.display = 'none';

        if (divId) {
            document.getElementById(divId).style.display = 'block';
        }
    };
    function setWhitelistVisibility(visible) {
        if (visible) {
            document.getElementById('whitelist').style.display = 'block';
        } else {
            document.getElementById('whitelist').style.display = 'none';
        }
    };
    function setSuspendOneVisibility(visible) {
        if (visible) {
            document.getElementById('suspendOne').style.display = 'block';
        } else {
            document.getElementById('suspendOne').style.display = 'none';
        }
    };

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

        chrome.windows.getCurrent({}, function (window) {

            chrome.tabs.query({windowId: window.id, highlighted: true}, function(tabs) {

                if (tabs.length > 0) {
                    var tab = tabs[0];
                    chrome.runtime.sendMessage({action: 'requestTabStatus', tab: tab});
                }
            });
        });

        chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
            if (request.action === 'confirmTabStatus' && request.status) {

                if (request.status === 'whitelisted') {
                    showStatusBar('whitelisted');
                    setWhitelistVisibility(false);

                } else if (request.status === 'formInput') {
                    showStatusBar('formInput');
                    setWhitelistVisibility(true);

                } else if (request.status === 'pinned') {
                    showStatusBar('pinnedTab');
                    setWhitelistVisibility(true);

                } else if (request.status === 'special') {
                    showStatusBar(false);
                    setWhitelistVisibility(false);

                } else if (request.status === 'normal') {
                    showStatusBar(false);
                    setWhitelistVisibility(true);
                }

                if (request.status === 'suspended' || request.status === 'special') {
                    setSuspendOneVisibility(false);

                } else {
                    setSuspendOneVisibility(true);
                }
            }
        });
    });

}());
