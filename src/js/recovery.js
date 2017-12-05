/*global chrome, historyItems */
(function () {
    'use strict';

    var gsAnalytics = chrome.extension.getBackgroundPage().gsAnalytics;
    var gsStorage = chrome.extension.getBackgroundPage().gsStorage;
    var gsUtils = chrome.extension.getBackgroundPage().gsUtils;
    var tgs = chrome.extension.getBackgroundPage().tgs;

    var restoreAttempted = false;
    var tabsToRecover = [];

    function populateRecoverableTabs() {
        return new Promise(function (resolve) {
            gsStorage.fetchLastSession().then(function (lastSession) {
                if (lastSession) {
                    gsUtils.removeInternalUrlsFromSession(lastSession);
                    lastSession.windows.forEach(function (window, index) {
                        window.tabs.forEach(function (tabProperties) {
                            if (gsUtils.isSuspendedTab(tabProperties)) {
                                tabProperties.windowId = window.id;
                                tabProperties.sessionId = lastSession.sessionId;
                                tabsToRecover.push(tabProperties);
                            }
                        });
                    });
                }
                resolve();
            });
        });
    }

    function removeSuspendedTabFromList(tabToRemove) {
        var recoveryTabsEl = document.getElementById('recoveryTabs'),
            childLinks = recoveryTabsEl.children;

        for (var i = 0; i < childLinks.length; i++) {
            var element = childLinks[i];
            if (element.getAttribute('data-url') === tabToRemove.url ||
                    element.getAttribute('data-tabId') == tabToRemove.id) { // eslint-disable-line eqeqeq
                recoveryTabsEl.removeChild(element);
            }
        }

        //if removing the last element.. (re-get the element this function gets called asynchronously
        if (document.getElementById('recoveryTabs').children.length === 0) {
            tgs.setRecoveryMode(false);

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

    chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
        removeSuspendedTabFromList(request);
    });

    gsUtils.documentReadyAndLocalisedAsPromsied(document).then(function () {

        var restoreEl = document.getElementById('restoreSession'),
            manageEl = document.getElementById('manageManuallyLink'),
            previewsEl = document.getElementById('previewsOffBtn'),
            recoveryEl = document.getElementById('recoveryTabs'),
            warningEl = document.getElementById('screenCaptureNotice'),
            tabEl;

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

        var performRestore = function () {
            tgs.setRecoveryMode(true);
            restoreAttempted = true;
            restoreEl.className += ' btnDisabled';
            restoreEl.removeEventListener('click', performRestore);
            gsUtils.recoverLostTabs();
        };

        restoreEl.addEventListener('click', performRestore);

        populateRecoverableTabs().then(function () {
            if (tabsToRecover.length === 0) {
                hideRecoverySection();
                return;
            }
            for (var tabToRecover of tabsToRecover) {
                if (!gsUtils.isInternalTab(tabToRecover)) {
                    tabEl = historyItems.createTabHtml(tabToRecover, false);
                    tabEl.onclick = function () {
                        return function (e) {
                            e.preventDefault();
                            chrome.tabs.create({url: tabToRecover.url, active: false});
                            removeSuspendedTabFromList(tabToRecover);
                        };
                    };
                    recoveryEl.appendChild(tabEl);
                }
            }
        });
    });

    gsAnalytics.reportPageView('recovery.html');
}());
