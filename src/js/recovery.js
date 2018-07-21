/*global chrome, historyItems */
(function() {
  'use strict';

  var gsAnalytics = chrome.extension.getBackgroundPage().gsAnalytics;
  var gsMessages = chrome.extension.getBackgroundPage().gsMessages;
  var gsSession = chrome.extension.getBackgroundPage().gsSession;
  var gsStorage = chrome.extension.getBackgroundPage().gsStorage;
  var gsUtils = chrome.extension.getBackgroundPage().gsUtils;

  var restoreAttempted = false;
  var tabsToRecover = [];

  function populateRecoverableTabs() {
    return new Promise(function(resolve) {
      gsStorage.fetchLastSession().then(function(lastSession) {
        //check to see if they still exist in current session
        chrome.tabs.query({}, function(currentTabs) {
          if (lastSession) {
            gsUtils.removeInternalUrlsFromSession(lastSession);
            lastSession.windows.forEach(function(window, index) {
              window.tabs.forEach(function(tabProperties) {
                if (gsUtils.isSuspendedTab(tabProperties)) {
                  var originalUrl = gsUtils.getSuspendedUrl(tabProperties.url);
                  // Ignore suspended tabs from previous session that exist unsuspended now
                  if (
                    !currentTabs.find(function(o) {
                      return o.url === originalUrl;
                    })
                  ) {
                    tabProperties.windowId = window.id;
                    tabProperties.sessionId = lastSession.sessionId;
                    tabsToRecover.push(tabProperties);
                  }
                }
              });
            });
            var currentSuspendedTabs = currentTabs.filter(function(o) {
              return gsUtils.isSuspendedTab(o, true);
            });
            currentSuspendedTabs.forEach(function(suspendedTab) {
              gsMessages.sendPingToTab(suspendedTab.id, function(err) {
                if (!err) {
                  removeSuspendedTabFromList(suspendedTab);
                }
              });
            });
          }
          resolve();
        });
      });
    });
  }

  function removeSuspendedTabFromList(tabToRemove) {
    var recoveryTabsEl = document.getElementById('recoveryTabs'),
      childLinks = recoveryTabsEl.children;

    for (var i = 0; i < childLinks.length; i++) {
      var element = childLinks[i];
      if (
        element.getAttribute('data-url') === tabToRemove.url ||
        element.getAttribute('data-tabId') == tabToRemove.id
      ) {
        // eslint-disable-line eqeqeq
        recoveryTabsEl.removeChild(element);
      }
    }

    //if removing the last element.. (re-get the element this function gets called asynchronously
    if (document.getElementById('recoveryTabs').children.length === 0) {
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

  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request && request.recoveredTab) {
      removeSuspendedTabFromList(request.recoveredTab);
    }
  });

  gsUtils.documentReadyAndLocalisedAsPromsied(document).then(function() {
    var restoreEl = document.getElementById('restoreSession'),
      manageEl = document.getElementById('manageManuallyLink'),
      previewsEl = document.getElementById('previewsOffBtn'),
      recoveryEl = document.getElementById('recoveryTabs'),
      warningEl = document.getElementById('screenCaptureNotice'),
      tabEl;

    manageEl.onclick = function(e) {
      e.preventDefault();
      chrome.tabs.create({ url: chrome.extension.getURL('history.html') });
    };

    if (previewsEl) {
      previewsEl.onclick = function(e) {
        gsStorage.setOption(gsStorage.SCREEN_CAPTURE, '0');
        window.location.reload();
      };

      //show warning if screen capturing turned on
      if (gsStorage.getOption(gsStorage.SCREEN_CAPTURE) !== '0') {
        warningEl.style.display = 'block';
      }
      //TODO: Potentially show warning here if SUSPEND_IN_PLACE_OF_DISCARD enabled?
    }

    var performRestore = function() {
      restoreAttempted = true;
      restoreEl.className += ' btnDisabled';
      restoreEl.removeEventListener('click', performRestore);
      gsSession.recoverLostTabs();
    };

    restoreEl.addEventListener('click', performRestore);

    populateRecoverableTabs().then(function() {
      if (tabsToRecover.length === 0) {
        hideRecoverySection();
        return;
      }
      for (var tabToRecover of tabsToRecover) {
        if (!gsUtils.isInternalTab(tabToRecover)) {
          tabEl = historyItems.createTabHtml(tabToRecover, false);
          tabEl.onclick = function() {
            return function(e) {
              e.preventDefault();
              chrome.tabs.create({ url: tabToRecover.url, active: false });
              removeSuspendedTabFromList(tabToRecover);
            };
          };
          recoveryEl.appendChild(tabEl);
        }
      }
    });
  });

  gsAnalytics.reportPageView('recovery.html');
})();
