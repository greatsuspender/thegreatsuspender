/*global chrome */

var _gaq = _gaq || [];
_gaq.push(['_setAccount', 'UA-52338347-1']);
_gaq.push(['_trackPageview']);

function trackButtonClick(e) {
    _gaq.push(['_trackEvent', e.target.id, 'clicked']);
}

(function () {

    'use strict';

    function setStatus(status) {
        if (status === 'normal') {
            document.getElementById('footer').style.display = 'none';
        } else {
            var statusDetail = '',
                statusSrc = '';

            if (status === 'special') {
                statusDetail = 'This tab cannot be suspended';
                statusSrc = 'img/status_special.png';

            } else if (status === 'suspended') {
                statusDetail = 'Tab suspended';
                statusSrc = 'img/status_pause.png';

            } else if (status === 'whitelisted') {
                statusDetail = 'This site has been whitelisted';
                statusSrc = 'img/status_whitelist.png';

            } else if (status === 'formInput') {
                statusDetail = 'This tab is currently receiving form input';
                statusSrc = 'img/status_edit.png';

            } else if (status === 'pinned') {
                statusDetail = 'This tab has been pinned';
                statusSrc = 'img/status_pin.png';

            } else if (status === 'tempWhitelist') {
                statusDetail = 'Tab suspension has been manually paused';
                statusSrc = 'img/status_pause.png';
            }

            document.getElementById('footer').style.display = 'block';
            document.getElementById('statusDetail').innerHTML = statusDetail;
            document.getElementById('statusImg').src = statusSrc;
        }
    }

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
    }

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
            trackButtonClick(e);
            chrome.runtime.sendMessage({ action: 'suspendOne' });
            window.close();
        });
        document.getElementById('suspendAll').addEventListener('click', function (e) {
            trackButtonClick(e);
            chrome.runtime.sendMessage({ action: 'suspendAll' });
            window.close();
        });
        document.getElementById('unsuspendAll').addEventListener('click', function (e) {
            trackButtonClick(e);
            chrome.runtime.sendMessage({ action: 'unsuspendAll' });
            window.close();
        });
        document.getElementById('whitelist').addEventListener('click', function (e) {
            trackButtonClick(e);
            if (e.target.getAttribute('data-action') === 'whitelist') {
                chrome.runtime.sendMessage({ action: 'whitelist' });
                window.close();
            } else if (e.target.getAttribute('data-action') === 'unwhitelist') {
                chrome.runtime.sendMessage({ action: 'removeWhitelist' });
                window.close();
            }
        });
        document.getElementById('tempWhitelist').addEventListener('click', function (e) {
            trackButtonClick(e);
            if (e.target.getAttribute('data-action') === 'pause') {
                chrome.runtime.sendMessage({ action: 'tempWhitelist' });
                chrome.extension.getBackgroundPage().tgs.updateIcon(false);
                window.close();
            } else if (e.target.getAttribute('data-action') === 'unpause') {
                chrome.runtime.sendMessage({ action: 'undoTempWhitelist' });
                window.close();
            }
        });
        document.getElementById('settingsLink').addEventListener('click', function (e) {
            trackButtonClick(e);
            chrome.tabs.create({
                url: chrome.extension.getURL('options.html')
            });
            window.close();
        });
        document.getElementById('historyLink').addEventListener('click', function (e) {
            trackButtonClick(e);
            chrome.tabs.create({
                url: chrome.extension.getURL('history.html')
            });
            window.close();
        });
        /*
        document.getElementById('history').addEventListener('click', function () {
            chrome.tabs.create({
                url: chrome.extension.getURL('history.html')
            });
            window.close();
        });
        */
        chrome.extension.getBackgroundPage().tgs.requestTabInfo(false, function (info) {
            var status = info.status,
                //timeLeft = info.timerUp, // unused
                suspendOneVisible = (status === 'suspended' || status === 'special') ? false : true;

            setSuspendOneVisibility(suspendOneVisible);
            setStatus(status);
            setWhitelistStatus(status);
            setPauseStatus(status);
        });
    });

    var ga = document.createElement('script');
    ga.type = 'text/javascript';
    ga.async = true;
    ga.src = 'https://ssl.google-analytics.com/ga.js';
    var s = document.getElementsByTagName('script')[0];
    s.parentNode.insertBefore(ga, s);

}());
