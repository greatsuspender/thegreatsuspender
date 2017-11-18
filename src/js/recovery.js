/*global chrome, historyItems */
(function () {
    'use strict';

    var gsAnalytics = chrome.extension.getBackgroundPage().gsAnalytics;
    var gsMessages = chrome.extension.getBackgroundPage().gsMessages;
    var gsStorage = chrome.extension.getBackgroundPage().gsStorage;
    var gsUtils = chrome.extension.getBackgroundPage().gsUtils;

    var restoreAttempted = false;

    function removeTabFromList(tab) {

        var recoveryTabsEl = document.getElementById('recoveryTabs'),
            childLinks = recoveryTabsEl.children;

        for (var i = 0; i < childLinks.length; i++) {
            var element = childLinks[i];
            if (element.getAttribute('data-url') === tab.url ||
                    element.getAttribute('data-tabId') == tab.id) { // eslint-disable-line eqeqeq
                recoveryTabsEl.removeChild(element);
            }
        }

        //if removing the last element
        if (recoveryTabsEl.children.length === 0) {

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

        var recoveryEl = document.getElementById('recoveryTabs'),
            tabEl;

        gsStorage.fetchLastSession().then(function (lastSession) {

            if (!lastSession) {
                hideRecoverySection();
                return;
            }

            lastSession.windows.forEach(function (window, index) {

                window.tabs.forEach(function (tabProperties) {

                    if (!gsUtils.isSpecialTab(tabProperties)) {
                        tabProperties.windowId = window.id;
                        tabProperties.sessionId = lastSession.sessionId;
                        tabEl = historyItems.createTabHtml(tabProperties, false);
                        tabEl.onclick = function (e) {
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

    function checkForActiveTabs() {

        //hide tabs that respond to getInfo request
        chrome.windows.getAll({ populate: true }, function (windows) {
            windows.forEach(function (curWindow) {
                curWindow.tabs.forEach(function (curTab) {
                    gsMessages.sendPingToTab(curTab.id, function (err) {
                        if (err) {
                            gsUtils.log('Could not make contact with tab: ' + curTab.id + '. Assuming tab has crashed.');
                        }
                        else {
                            removeTabFromList(curTab);
                        }
                    });
                });
            });
        });
    }

    gsUtils.documentReadyAndLocalisedAsPromsied(document).then(function () {

        var restoreEl = document.getElementById('restoreSession'),
            manageEl = document.getElementById('manageManuallyLink'),
            previewsEl = document.getElementById('previewsOffBtn'),
            warningEl = document.getElementById('screenCaptureNotice');

        var handleAutoRestore = function () {
            restoreAttempted = true;
            restoreEl.className += ' btnDisabled';
            gsUtils.recoverLostTabs(checkForActiveTabs);
            restoreEl.removeEventListener('click', handleAutoRestore);
        };

        restoreEl.addEventListener('click', handleAutoRestore);

        manageEl.onclick = function (e) {
            e.preventDefault();
            chrome.tabs.create({ url: chrome.extension.getURL('history.html') });
        };

        if (previewsEl) {
            previewsEl.onclick = function (e) {
                gsStorage.setOption(gsStorage.SCREEN_CAPTURE, '0');
                window.location.reload();
            };

            //show warning if screen capturing turned on
            if (gsStorage.getOption(gsStorage.SCREEN_CAPTURE) !== '0') {
                warningEl.style.display = 'block';
            }
        }

        populateMissingTabs();
    });

    gsAnalytics.reportPageView('recovery.html');
}());
