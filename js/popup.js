/*global chrome */

(function () {

    'use strict';

    function setStatus(status) {

        var statusDetail = '',
            statusSrc = '',
            message;

        if (status === 'normal') {
            statusDetail = 'Tab will be suspended.';
            statusSrc = '';

        } else if (status === 'special') {
            statusDetail = 'Tab cannot be suspended.';
            statusSrc = '/img/status_special.png';

        } else if (status === 'suspended') {
            statusDetail = 'Tab suspended. <a>Reload</a>';
            statusSrc = '/img/status_pause.png';
            message = 'unsuspendOne';

        } else if (status === 'whitelisted') {
            statusDetail = 'Site is whitelisted. <a>Remove from whitelist</a>';
            statusSrc = '/img/status_whitelist.png';
            message = 'removeWhitelist';

        } else if (status === 'formInput') {
            statusDetail = 'Tab is currently receiving form input.';
            statusSrc = '/img/status_edit.png';

        } else if (status === 'pinned') {
            statusDetail = 'Tab has been pinned.';
            statusSrc = '/img/status_pin.png';

        } else if (status === 'tempWhitelist') {
            statusDetail = 'Tab suspension paused. <a>Unpause</a>';
            statusSrc = '/img/status_pause.png';
            message = 'undoTempWhitelist';
        }

        if (document.getElementsByTagName('a')[0]) {
            document.getElementsByTagName('a')[0].removeEventListener('click');
        }

        document.getElementById('header').style.display = 'block';
        document.getElementById('statusDetail').innerHTML = statusDetail;
        document.getElementById('statusImg').src = statusSrc;

        if (message) {
            document.getElementsByTagName('a')[0].addEventListener('click', function (e) {
                chrome.runtime.sendMessage({ action: message });
                chrome.extension.getBackgroundPage().tgs.updateIcon('normal');
                window.close();
            });
        }
    }

    function setWhitelistVisibility(visible) {
        if (visible) {
            document.getElementById('whitelist').style.display = 'block';
        } else {
            document.getElementById('whitelist').style.display = 'none';
        }
    }

    function setPauseVisibility(visible) {
        if (visible) {
            document.getElementById('tempWhitelist').style.display = 'block';
        } else {
            document.getElementById('tempWhitelist').style.display = 'none';
        }
    }

    function setSuspendOneVisibility(visible) {
        if (visible) {
            document.getElementById('suspendOne').style.display = 'block';
        } else {
            document.getElementById('suspendOne').style.display = 'none';
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        document.getElementById('suspendOne').addEventListener('click', function (e) {
            chrome.runtime.sendMessage({ action: 'suspendOne' });
            window.close();
        });
        document.getElementById('suspendAll').addEventListener('click', function (e) {
            chrome.runtime.sendMessage({ action: 'suspendAll' });
            window.close();
        });
        document.getElementById('unsuspendAll').addEventListener('click', function (e) {
            chrome.runtime.sendMessage({ action: 'unsuspendAll' });
            window.close();
        });
        document.getElementById('whitelist').addEventListener('click', function (e) {
            chrome.runtime.sendMessage({ action: 'whitelist' });
            chrome.extension.getBackgroundPage().tgs.updateIcon(false);
            window.close();
        });
        document.getElementById('tempWhitelist').addEventListener('click', function (e) {
            chrome.runtime.sendMessage({ action: 'tempWhitelist' });
            chrome.extension.getBackgroundPage().tgs.updateIcon(false);
            window.close();
        });
        document.getElementById('settingsLink').addEventListener('click', function (e) {
            chrome.tabs.create({
                url: chrome.extension.getURL('options.html')
            });
            window.close();
        });
        chrome.extension.getBackgroundPage().tgs.requestTabInfo(false, function (info) {
            var status = info.status,
                //timeLeft = info.timerUp, // unused
                suspendOneVisible = (status === 'suspended' || status === 'special') ? false : true,
                whitelistVisibe = (status !== 'whitelisted') ? true : false,
                pauseVisibe = (status === 'normal') ? true : false;

            setSuspendOneVisibility(suspendOneVisible);
            setWhitelistVisibility(whitelistVisibe);
            setPauseVisibility(pauseVisibe);
            setStatus(status);
        });
    });

}());
