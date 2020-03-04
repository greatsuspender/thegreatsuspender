let gsGlobals;
try {
  gsGlobals = chrome.extension.getBackgroundPage().gsGlobals;
  if (!gsGlobals) throw new Error();
} catch (e) {
  window.setTimeout(() => window.location.reload(), 1000);
  return;
}

const {
  warning,
  removeInternalUrlsFromSession,
  isSuspendedTab,
  getOriginalUrlFromSuspendedUrl,
  documentReadyAndLocalisedAsPromsied,
  getCleanTabTitle,
} = gsGlobals.gsUtils;
const { fetchLastSession } = gsGlobals.gsIndexedDb;
const { tabsQuery } = gsGlobals.gsChrome;
const { isInitialising, recoverLostTabs } = gsGlobals.gsSession;
const { SCREEN_CAPTURE, setOptionAndSync, getOption } = gsGlobals.gsStorage;
const { sendPingToTab } = gsGlobals.gsMessages;
const { createTabHtml } = gsGlobals.gsHistoryItems;
const { reportPageView } = gsGlobals.gsAnalytics;
const { registerViewGlobal, VIEW_FUNC_RECOVERY_REMOVE_TAB } = gsGlobals.gsViews;

let restoreAttempted = false;
const tabsToRecover = [];

async function getRecoverableTabs(currentTabs) {
  const lastSession = await fetchLastSession();
  //check to see if they still exist in current session
  if (lastSession) {
    removeInternalUrlsFromSession(lastSession);
    for (const window of lastSession.windows) {
      for (const tabProperties of window.tabs) {
        if (isSuspendedTab(tabProperties)) {
          // Ignore suspended tabs that still exist in current session
          const suspendedTab = currentTabs.find(o => o.url === tabProperties.url);
          // Also ignore suspended tabs from previous session that exist unsuspended now
          const originalUrl = getOriginalUrlFromSuspendedUrl(tabProperties.url);
          const originalTab = currentTabs.find(o => o.url === originalUrl);
          if (!suspendedTab && !originalTab) {
            tabProperties.windowId = window.id;
            tabProperties.sessionId = lastSession.sessionId;
            tabsToRecover.push(tabProperties);
          }
        }
      }
    }
    return tabsToRecover;
  }
}

const removeTabFromList = tabToRemove => {
  const recoveryTabsEl = document.getElementById('recoveryTabs');
  const childLinks = recoveryTabsEl.children;

  for (let i = 0; i < childLinks.length; i++) {
    const element = childLinks[i];
    const url = isSuspendedTab(tabToRemove)
      ? getOriginalUrlFromSuspendedUrl(tabToRemove.url)
      : tabToRemove.url;

    if (
      element.getAttribute('data-url') === url ||
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
      document.getElementById('suspendy-guy-inprogress').style.display = 'none';
      document.getElementById('recovery-inprogress').style.display = 'none';
      document.getElementById('suspendy-guy-complete').style.display =
        'inline-block';
      document.getElementById('recovery-complete').style.display =
        'inline-block';

      //otherwise we have no tabs to recover so just hide references to recovery
    } else {
      hideRecoverySection();
    }
  }
};

function showTabSpinners() {
  const recoveryTabsEl = document.getElementById('recoveryTabs');
  const childLinks = recoveryTabsEl.children;

  for (let i = 0; i < childLinks.length; i++) {
    const tabContainerEl = childLinks[i];
    tabContainerEl.removeChild(tabContainerEl.firstChild);
    const spinnerEl = document.createElement('span');
    spinnerEl.classList.add('faviconSpinner');
    tabContainerEl.insertBefore(spinnerEl, tabContainerEl.firstChild);
  }
}

function hideRecoverySection() {
  const recoverySectionEls = document.getElementsByClassName('recoverySection');
  for (let i = 0; i < recoverySectionEls.length; i++) {
    recoverySectionEls[i].style.display = 'none';
  }
  document.getElementById('restoreSession').style.display = 'none';
}

documentReadyAndLocalisedAsPromsied(document).then(async function() {
  const restoreEl = document.getElementById('restoreSession');
  const manageEl = document.getElementById('manageManuallyLink');
  const previewsEl = document.getElementById('previewsOffBtn');
  const recoveryEl = document.getElementById('recoveryTabs');
  const warningEl = document.getElementById('screenCaptureNotice');

  manageEl.onclick = function(e) {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('history.html') });
  };

  if (previewsEl) {
    previewsEl.onclick = function() {
      setOptionAndSync(SCREEN_CAPTURE, '0');
      window.location.reload();
    };

    //show warning if screen capturing turned on
    if (getOption(SCREEN_CAPTURE) !== '0') {
      warningEl.style.display = 'block';
    }
  }

  const performRestore = async function() {
    restoreAttempted = true;
    restoreEl.className += ' btnDisabled';
    restoreEl.removeEventListener('click', performRestore);
    showTabSpinners();
    // Can cause lockup if initialising never finishes!!
    // while (isInitialising()) {
    //   await setTimeout(200);
    // }
    await recoverLostTabs();
  };

  restoreEl.addEventListener('click', performRestore);

  const currentTabs = await tabsQuery();
  const tabsToRecover = await getRecoverableTabs(currentTabs);
  if (tabsToRecover.length === 0) {
    hideRecoverySection();
    return;
  }

  for (const tabToRecover of tabsToRecover) {
    tabToRecover.title = getCleanTabTitle(tabToRecover);
    tabToRecover.url = getOriginalUrlFromSuspendedUrl(tabToRecover.url);
    const tabEl = await createTabHtml(tabToRecover, false);
    tabEl.onclick = function() {
      return function(e) {
        e.preventDefault();
        chrome.tabs.create({ url: tabToRecover.url, active: false });
        removeTabFromList(tabToRecover);
      };
    };
    recoveryEl.appendChild(tabEl);
  }

  const currentSuspendedTabs = currentTabs.filter(o => isSuspendedTab(o));
  for (const suspendedTab of currentSuspendedTabs) {
    sendPingToTab(suspendedTab.id, function(error) {
      if (error) {
        warning(suspendedTab.id, 'Failed to sendPingToTab', error);
      } else {
        removeTabFromList(suspendedTab);
      }
    });
  }
});

registerViewGlobal(window, VIEW_FUNC_RECOVERY_REMOVE_TAB, removeTabFromList);
reportPageView('recovery.html');
