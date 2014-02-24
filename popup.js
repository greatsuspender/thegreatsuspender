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

        chrome.windows.getLastFocused({populate: true}, function suspendHighlightedTab(window) {

            chrome.tabs.query({windowId: window.id, highlighted: true}, function(tabs) {

                if (tabs.length > 0) {
                    var tab = tabs[0];

                    if (chrome.extension.getBackgroundPage().tgs.checkWhiteList(tab.url)) {
                        showStatusBar('whitelisted');
                        setWhitelistVisibility(false);

                    } else if (chrome.extension.getBackgroundPage().tgs.isTempWhitelisted(tab)) {
                        showStatusBar('formInput');
                        setWhitelistVisibility(true);

                    } else if (chrome.extension.getBackgroundPage().tgs.isPinnedTab(tab)) {
                        showStatusBar('pinnedTab');
                        setWhitelistVisibility(true);

                    } else if (chrome.extension.getBackgroundPage().tgs.isSpecialTab(tab)) {
                        showStatusBar(false);
                        setWhitelistVisibility(false);

                    } else {
                        showStatusBar(false);
                        setWhitelistVisibility(true);
                    }

                    if (!chrome.extension.getBackgroundPage().tgs.isSuspended(tab) &&
                            !chrome.extension.getBackgroundPage().tgs.isSpecialTab(tab)) {
                        setSuspendOneVisibility(true);
                    } else {
                        setSuspendOneVisibility(false);
                    }
                }
            });
        });
    });

}());
