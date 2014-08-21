/*global document, chrome, window */

(function() {

    'use strict';
    var enableWhitelist = true,
        enablePause = true;

    function setStatus(status) {

        if (status === 'normal' || status === 'suspended') {
            document.getElementById('footer').style.display = 'none';

        } else {
            var statusDetail = '';
            var statusSrc = '';

            if (status === 'special') {
                statusDetail = 'This tab cannot be suspended';
                statusSrc = 'status_special.png';

            } else if (status === 'whitelisted') {
                statusDetail = 'This tab has been whitelisted';
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
        if (status === 'whitelisted' || status === 'special') {
            //document.getElementById('whitelist').style.display = 'none';
            document.getElementById('whitelist').innerHTML = 'Tab Whitelisted';
            document.getElementById('whitelist').className = 'bottomOption disabled';
        } else {
            //document.getElementById('whitelist').style.display = 'block';
            document.getElementById('whitelist').innerHTML = 'Whitelist Tab';
            document.getElementById('whitelist').className = 'bottomOption';
        }
    };
    function setTemporaryWhitelistStatus(status) {
        if (status === 'normal') {
            //document.getElementById('tempWhitelist').style.display = 'block';
            document.getElementById('tempWhitelist').innerHTML = 'Pause Suspension';
            document.getElementById('tempWhitelist').className = 'bottomOption';
        } else if (status === 'suspended') {
            //document.getElementById('whitelist').style.display = 'block';
            document.getElementById('tempWhitelist').innerHTML = 'Tab Suspended';
            document.getElementById('tempWhitelist').className = 'bottomOption disabled';
        } else {
            //document.getElementById('tempWhitelist').style.display = 'none';
            document.getElementById('tempWhitelist').innerHTML = 'Suspension Paused';
            document.getElementById('tempWhitelist').className = 'bottomOption disabled';
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
        document.getElementById('whitelist').addEventListener('click', function() {
            if (enableWhitelist) {
                chrome.runtime.sendMessage({ action: 'whitelist' });
               window.close();
           }
        });
        document.getElementById('tempWhitelist').addEventListener('click', function() {
            if (enablePause) {
                chrome.runtime.sendMessage({ action: 'tempWhitelist' });
                chrome.extension.getBackgroundPage().tgs.updateIcon(false);
                window.close();
            }
        });
        document.getElementById('popTopSettings').addEventListener('click', function() {
            chrome.tabs.create({
                url: chrome.extension.getURL('options.html')
            });
            window.close();
        });
        /*document.getElementById('history').addEventListener('click', function() {
            chrome.tabs.create({
                url: chrome.extension.getURL('history.html')
            });
            window.close();
        });
*/
        chrome.extension.getBackgroundPage().tgs.requestTabInfo(false, function(info) {

            var status = info.status,
                timeLeft = info.timerUp,
                suspendOneVisible = (status === 'suspended' || status === 'special') ? false : true;

            enablePause = (status === 'normal') ? true : false;
            enableWhitelist = (status === 'whitelisted' || status === 'special') ? false : true;

            setSuspendOneVisibility(suspendOneVisible);

            setStatus(status);
            setWhitelistStatus(status);
            setTemporaryWhitelistStatus(status);
        });
    });

}());
