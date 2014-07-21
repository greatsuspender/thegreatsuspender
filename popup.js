/*global document, chrome, window */

(function() {

    'use strict';

    function setStatusBar(info) {

        console.dir(info);

        var text = '<span>status: ' + info.status + '</span>';
        document.getElementById('statusText').innerHTML = text;
    };
    function setWhitelistVisibility(visible) {
        if (visible) {
            document.getElementById('whitelist').style.display = 'block';
            //document.getElementById('whitelist').innerHTML = 'Whitelist tab';
        } else {
            document.getElementById('whitelist').style.display = 'none';
            //document.getElementById('whitelist').innerHTML = 'Tab whitelisted';
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
        document.getElementById('history').addEventListener('click', function() {
            chrome.tabs.create({
                url: chrome.extension.getURL('history.html')
            });
            window.close();
        });

        chrome.windows.getCurrent({}, function(window) {

            chrome.tabs.query({windowId: window.id, highlighted: true}, function(tabs) {

                if (tabs.length > 0) {
                    var tab = tabs[0];
                    chrome.runtime.sendMessage({action: 'requestTabInfo', tab: tab});
                }
            });
        });

        chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
            if (request.action === 'confirmTabInfo' && request.info) {

                var status = request.info.status,
                    timeLeft = request.info.timerUp,
                    whitelistVisible = (status === 'whitelisted' || status === 'special') ? false : true,
                    suspendOneVisible = (status === 'suspended' || status === 'special') ? false : true;

                setWhitelistVisibility(whitelistVisible);
                setSuspendOneVisibility(suspendOneVisible);

                setStatusBar(request.info);
            }
        });
    });

}());
