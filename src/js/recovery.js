/*global chrome */

(function () {

    'use strict';
    var gsUtils = chrome.extension.getBackgroundPage().gsUtils,
        restoreAttempted = false;

    function removeTabFromList(tab) {

        var recoveryLinksEl = document.getElementById('recoveryLinks'),
            childLinks = recoveryLinksEl.children;

        for (var i = 0; i < childLinks.length; i++) {
            var element = childLinks[i];
            if (element.getAttribute('data-url') === tab.url
                    || element.getAttribute('data-tabId') == tab.id) { //do a loose match on id here
                recoveryLinksEl.removeChild(element);
            }
        }

        //if removing the last element
        if (recoveryLinks.children.length === 0) {

            //if we have already clicked the restore button then redirect to success page
            if (restoreAttempted) {
                window.location.href = chrome.extension.getURL('success.html');

            //otherwise we have no tabs to recover so just hide references to recovery
            } else {
                hideRecoverySection();
            }
        }
    }

    function hideRecoverySection() {
        var recoverySectionEls = document.getElementsByClassName('recoverySection');
        for (var i = 0; i < recoverySectionEls.length; i++) {
            recoverySectionEls[i].style.display = 'none';
        }
    }

    function populateMissingTabs() {

        var recoveryEl = document.getElementById('recoveryLinks'),
            tabEl;

        gsUtils.fetchLastSession().then(function (lastSession) {

            if (!lastSession) {
                hideRecoverySection();
                return;
            }

            lastSession.windows.forEach(function (window, index) {

                window.tabs.forEach(function (tabProperties) {

                    if (!chrome.extension.getBackgroundPage().tgs.isSpecialTab(tabProperties)) {
                        tabProperties.windowId = window.id;
                        tabProperties.sessionId = lastSession.sessionId;
                        tabEl = sessionUtils.createTabHtml(tabProperties, true);
                        tabEl.onclick = function(e) {
                            e.preventDefault();
                            chrome.tabs.create({url: tabProperties.url, active: false});
                            removeTabFromList(tabProperties);
                        };
                        recoveryEl.appendChild(tabEl);
                    }
                });
            });
            checkForActiveTabs();
        });
    }

    function sendMessageToTab(tabId, message, callback) {
        try {
            chrome.tabs.sendMessage(tabId, message, {frameId: 0}, callback);
        }
        catch(e) {
            chrome.tabs.sendMessage(tabId, message, callback);
        }
    }

    function checkForActiveTabs() {

        //hide tabs that respond to getInfo request
        chrome.windows.getAll({ populate: true }, function (windows) {
            windows.forEach(function (curWindow) {
                curWindow.tabs.forEach(function (curTab) {
                    sendMessageToTab(curTab.id, {action: 'requestInfo'}, function (response) {
                        removeTabFromList(curTab);
                    });
                });
            });
        });
    }

    var readyStateCheckInterval = window.setInterval(function () {
        if (document.readyState === 'complete') {

            window.clearInterval(readyStateCheckInterval);

            var restoreEl = document.getElementById('restoreSession'),
                manageEl = document.getElementById('manageManuallyLink'),
                previewsEl = document.getElementById('previewsOffBtn'),
                warningEl = document.getElementById('screenCaptureNotice');

            var handleAutoRestore = function () {
                restoreAttempted = true;
                restoreEl.className += " btnDisabled";
                gsUtils.recoverLostTabs(checkForActiveTabs);
                restoreEl.removeEventListener('click', handleAutoRestore);
            };

            restoreEl.addEventListener('click', handleAutoRestore);

            manageEl.onclick = function (e) {
                window.location.href = chrome.extension.getURL('history.html');
            };

            if (previewsEl) {
                previewsEl.onclick = function (e) {
                    gsUtils.setOption(gsUtils.SCREEN_CAPTURE, '0');
                    window.location.reload();
                };

                //show warning if screen capturing turned on
                if (gsUtils.getOption(gsUtils.SCREEN_CAPTURE) !== '0') {
                    warningEl.style.display = 'block';
                }
            }

            populateMissingTabs();

        }
    }, 50);

}());
