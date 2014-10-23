/*global document, chrome, window */

(function () {

    'use strict';

    function setStatus(status) {

        if (status === 'normal') {
            document.getElementById('footer').style.display = 'none';

        } else {
            var statusDetail = '';
            var statusSrc = '';

            if (status === 'special') {
                statusDetail = 'This tab cannot be suspended';
                statusSrc = 'status_special.png';

            } else if (status === 'suspended') {
                statusDetail = 'Tab suspended';
                statusSrc = 'status_pause.png';

            } else if (status === 'whitelisted') {
                statusDetail = 'This site has been whitelisted';
                statusSrc = 'status_whitelist.png';

            } else if (status === 'formInput') {
                statusDetail = 'This tab is currently receiving form input';
                statusSrc = 'status_edit.png';

            } else if (status === 'pinned') {
                statusDetail = 'This tab has been pinned';
                statusSrc = 'status_pin.png';

            } else if (status === 'tempWhitelist') {
                statusDetail = 'Tab suspension has been manually paused';
                statusSrc = 'status_pause.png';
            }

            document.getElementById('footer').style.display = 'block';
            document.getElementById('statusDetail').innerHTML = statusDetail;
            document.getElementById('statusImg').src = statusSrc;
        }
    };
    function setWhitelistStatus(status) {

        if (status === 'special') {
            document.getElementById('whitelist').style.display = 'none';

        } else if (status === 'whitelisted') {
            document.getElementById('whitelist').style.display = 'block';
            document.getElementById('whitelist').innerHTML = 'Unwhitelist';
            document.getElementById('whitelist').className = 'bottomOption undo';
            document.getElementById('whitelist').setAttribute('data-action', 'unwhitelist');

        } else {
            document.getElementById('whitelist').style.display = 'block';
            document.getElementById('whitelist').innerHTML = 'Whitelist site';
            document.getElementById('whitelist').className = 'bottomOption';
            document.getElementById('whitelist').setAttribute('data-action', 'whitelist');
        }
    };

    function setPauseStatus(status) {

        if (status === 'special') {
            document.getElementById('tempWhitelist').style.display = 'none';

        } else if (status === 'suspended' || status === 'whitelisted') {
            document.getElementById('tempWhitelist').style.display = 'block';
            document.getElementById('tempWhitelist').innerHTML = 'Pause suspension';
            document.getElementById('tempWhitelist').className = 'bottomOption disabled';
            document.getElementById('tempWhitelist').setAttribute('data-action', '');

        } else if (status === 'normal') {
            document.getElementById('tempWhitelist').style.display = 'block';
            document.getElementById('tempWhitelist').innerHTML = 'Pause suspension';
            document.getElementById('tempWhitelist').className = 'bottomOption';
            document.getElementById('tempWhitelist').setAttribute('data-action', 'pause');

        } else {
            document.getElementById('tempWhitelist').style.display = 'block';
            document.getElementById('tempWhitelist').innerHTML = 'Unpause suspension';
            document.getElementById('tempWhitelist').className = 'bottomOption undo';
            document.getElementById('tempWhitelist').setAttribute('data-action', 'unpause');
        }
    };

    function setSuspendOneVisibility(visible) {
        if (visible) {
            document.getElementById('suspendOne').style.display = 'block';
        } else {
            document.getElementById('suspendOne').style.display = 'none';
        }
    };

    document.addEventListener('DOMContentLoaded', function () {

        document.getElementById('suspendOne').addEventListener('click', function () {
            chrome.runtime.sendMessage({ action: 'suspendOne' });
            window.close();
        });
        document.getElementById('suspendAll').addEventListener('click', function () {
            chrome.runtime.sendMessage({ action: 'suspendAll' });
            window.close();
        });
        document.getElementById('unsuspendAll').addEventListener('click', function () {
            chrome.runtime.sendMessage({ action: 'unsuspendAll' });
            window.close();
        });
        document.getElementById('whitelist').addEventListener('click', function (e) {
            if (e.target.getAttribute('data-action') === 'whitelist') {
                chrome.runtime.sendMessage({ action: 'whitelist' });
                window.close();
            } else if (e.target.getAttribute('data-action') === 'unwhitelist') {
                chrome.runtime.sendMessage({ action: 'removeWhitelist' });
                window.close();
            }
        });
        document.getElementById('tempWhitelist').addEventListener('click', function (e) {
            if (e.target.getAttribute('data-action') === 'pause') {
                chrome.runtime.sendMessage({ action: 'tempWhitelist' });
                chrome.extension.getBackgroundPage().tgs.updateIcon(false);
                window.close();
            } else if (e.target.getAttribute('data-action') === 'unpause') {
                chrome.runtime.sendMessage({ action: 'undoTempWhitelist' });
                window.close();
            }
        });
        document.getElementById('popTopSettings').addEventListener('click', function () {
            chrome.tabs.create({
                url: chrome.extension.getURL('options.html')
            });
            window.close();
        });
        /*document.getElementById('history').addEventListener('click', function () {
            chrome.tabs.create({
                url: chrome.extension.getURL('history.html')
            });
            window.close();
        });
*/
        chrome.extension.getBackgroundPage().tgs.requestTabInfo(false, function (info) {

            var status = info.status,
                timeLeft = info.timerUp,
                suspendOneVisible = (status === 'suspended' || status === 'special') ? false : true;

            setSuspendOneVisibility(suspendOneVisible);

            setStatus(status);
            setWhitelistStatus(status);
            setPauseStatus(status);
        });
    });

}());
