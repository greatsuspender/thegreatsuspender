/*global document, chrome, window */

(function() {

    'use strict';

    function setStatusBar(info) {

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
    function setTemporaryWhitelistVisibility(visible) {
        if (visible) {
            document.getElementById('tempWhitelist').style.display = 'block';
        } else {
            document.getElementById('tempWhitelist').style.display = 'none';
        }
    };
    function setTemporaryWhitelistedVisibility(visible) {
        if (visible) {
            document.getElementById('tempWhitelisted').style.display = 'block';
            document.getElementById('tempWhitelisted').innerHTML = 'Tab temp whitelisted';
        } else {
            document.getElementById('tempWhitelisted').style.display = 'none';
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
        document.getElementById('tempWhitelist').addEventListener('click', function() {
            chrome.runtime.sendMessage({ action: 'tempWhitelist' });
            chrome.extension.getBackgroundPage().tgs.updateIcon(false);
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

        chrome.extension.getBackgroundPage().tgs.requestTabInfo(false, function(info) {

            var status = info.status,
                timeLeft = info.timerUp,
                whitelistVisible = (status === 'whitelisted' || status === 'special') ? false : true,
                tempWhitelistVisible = (status === 'normal') ? true : false,
                tempWhitelistedVisible = (status === 'formInput' || status === 'special' 
                    || status === 'pinned'|| status === 'tempWhitelist') ? true : false,
                suspendOneVisible = (status === 'suspended' || status === 'special') ? false : true;

            setWhitelistVisibility(whitelistVisible);
            setTemporaryWhitelistVisibility(tempWhitelistVisible);
            setTemporaryWhitelistedVisibility(tempWhitelistedVisible);
            setSuspendOneVisibility(suspendOneVisible);

            setStatusBar(info);
        });
    });

}());
