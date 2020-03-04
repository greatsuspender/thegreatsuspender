let gsGlobals;
try {
  gsGlobals = chrome.extension.getBackgroundPage().gsGlobals;
  if (!gsGlobals) throw new Error();
} catch (e) {
  window.setTimeout(() => window.location.reload(), 1000);
  return;
}

const {
  getCleanTabTitle,
  isSuspendedTab,
  getOriginalUrlFromSuspendedUrl,
  getWindowFromSession,
  removeInternalUrlsFromSession,
  documentReadyAndLocalisedAsPromsied,
} = gsGlobals.gsUtils;
const {
  fetchSessionBySessionId,
  removeSessionFromHistory,
  removeTabFromSessionHistory,
  fetchCurrentSessions,
  fetchSavedSessions,
} = gsGlobals.gsIndexedDb;
const { restoreSessionWindow, getSessionId } = gsGlobals.gsSession;
const {
  createSessionHtml,
  createTabHtml,
  createWindowHtml,
} = gsGlobals.gsHistoryItems;
const {
  exportSessionWithId,
  saveSession,
  importSession,
} = gsGlobals.gsHistoryUtils;
const { reportPageView } = gsGlobals.gsAnalytics;

const reloadTabs = async (sessionId, windowId, openTabsAsSuspended) => {
  const session = await fetchSessionBySessionId(sessionId);
  if (!session || !session.windows) {
    return;
  }

  removeInternalUrlsFromSession(session);

  //if loading a specific window
  let sessionWindows = [];
  if (windowId) {
    sessionWindows.push(getWindowFromSession(windowId, session));
    //else load all windows from session
  } else {
    sessionWindows = session.windows;
  }

  for (const sessionWindow of sessionWindows) {
    const suspendMode = openTabsAsSuspended ? 1 : 2;
    await restoreSessionWindow(sessionWindow, null, suspendMode);
  }
};

const deleteSession = sessionId => {
  const result = window.confirm(
    chrome.i18n.getMessage('js_history_confirm_delete')
  );
  if (result) {
    removeSessionFromHistory(sessionId).then(function() {
      window.location.reload();
    });
  }
};

const removeTab = (element, sessionId, windowId, tabId) => {
  removeTabFromSessionHistory(sessionId, windowId, tabId).then(function(
    session
  ) {
    removeInternalUrlsFromSession(session);
    //if we have a valid session returned
    if (session) {
      const sessionEl = element.parentElement.parentElement;
      const newSessionEl = createSessionElement(session);
      sessionEl.parentElement.replaceChild(newSessionEl, sessionEl);
      toggleSession(newSessionEl, session.sessionId); //async. unhandled promise

      //otherwise assume it was the last tab in session and session has been removed
    } else {
      window.location.reload();
    }
  });
};

const toggleSession = (element, sessionId) => {
  const sessionContentsEl = element.getElementsByClassName(
    'sessionContents'
  )[0];
  const sessionIcon = element.getElementsByClassName('sessionIcon')[0];
  if (sessionIcon.classList.contains('icon-plus-squared-alt')) {
    sessionIcon.classList.remove('icon-plus-squared-alt');
    sessionIcon.classList.add('icon-minus-squared-alt');
  } else {
    sessionIcon.classList.remove('icon-minus-squared-alt');
    sessionIcon.classList.add('icon-plus-squared-alt');
  }

  //if toggled on already, then toggle off
  if (sessionContentsEl.childElementCount > 0) {
    sessionContentsEl.innerHTML = '';
    return;
  }

  fetchSessionBySessionId(sessionId).then(async function(curSession) {
    if (!curSession || !curSession.windows) {
      return;
    }
    removeInternalUrlsFromSession(curSession);

    for (const [i, curWindow] of curSession.windows.entries()) {
      curWindow.sessionId = curSession.sessionId;
      sessionContentsEl.appendChild(
        createWindowElement(curSession, curWindow, i)
      );

      const tabPromises = [];
      for (const curTab of curWindow.tabs) {
        curTab.windowId = curWindow.id;
        curTab.sessionId = curSession.sessionId;
        curTab.title = getCleanTabTitle(curTab);
        if (isSuspendedTab(curTab)) {
          curTab.url = getOriginalUrlFromSuspendedUrl(curTab.url);
        }
        tabPromises.push(createTabElement(curSession, curWindow, curTab));
      }
      const tabEls = await Promise.all(tabPromises);
      for (const tabEl of tabEls) {
        sessionContentsEl.appendChild(tabEl);
      }
    }
  });
};

const addClickListenerToElement = (element, func) => {
  if (element) {
    element.onclick = func;
  }
};

const createSessionElement = session => {
  const sessionEl = createSessionHtml(session, true);

  addClickListenerToElement(
    sessionEl.getElementsByClassName('sessionIcon')[0],
    function() {
      toggleSession(sessionEl, session.sessionId); //async. unhandled promise
    }
  );
  addClickListenerToElement(
    sessionEl.getElementsByClassName('sessionLink')[0],
    function() {
      toggleSession(sessionEl, session.sessionId); //async. unhandled promise
    }
  );
  addClickListenerToElement(
    sessionEl.getElementsByClassName('exportLink')[0],
    function() {
      exportSessionWithId(session.sessionId);
    }
  );
  addClickListenerToElement(
    sessionEl.getElementsByClassName('resuspendLink')[0],
    function() {
      reloadTabs(session.sessionId, null, true); // async
    }
  );
  addClickListenerToElement(
    sessionEl.getElementsByClassName('reloadLink')[0],
    function() {
      reloadTabs(session.sessionId, null, false); // async
    }
  );
  addClickListenerToElement(
    sessionEl.getElementsByClassName('saveLink')[0],
    function() {
      saveSession(session.sessionId);
    }
  );
  addClickListenerToElement(
    sessionEl.getElementsByClassName('deleteLink')[0],
    function() {
      deleteSession(session.sessionId);
    }
  );
  return sessionEl;
};

const createWindowElement = (session, window, index) => {
  const allowReload = session.sessionId !== getSessionId();
  const windowEl = createWindowHtml(window, index, allowReload);

  addClickListenerToElement(
    windowEl.getElementsByClassName('resuspendLink')[0],
    function() {
      reloadTabs(session.sessionId, window.id, true); // async
    }
  );
  addClickListenerToElement(
    windowEl.getElementsByClassName('reloadLink')[0],
    function() {
      reloadTabs(session.sessionId, window.id, false); // async
    }
  );
  return windowEl;
};

const createTabElement = async (session, window, tab) => {
  const allowDelete = session.sessionId !== getSessionId();
  const tabEl = await createTabHtml(tab, allowDelete);

  addClickListenerToElement(
    tabEl.getElementsByClassName('removeLink')[0],
    function() {
      removeTab(tabEl, session.sessionId, window.id, tab.id);
    }
  );
  return tabEl;
};

const render = () => {
  const currentDiv = document.getElementById('currentSessions');
  const sessionsDiv = document.getElementById('recoverySessions');
  const historyDiv = document.getElementById('historySessions');
  const importSessionEl = document.getElementById('importSession');
  const importSessionActionEl = document.getElementById('importSessionAction');
  let firstSession = true;

  currentDiv.innerHTML = '';
  sessionsDiv.innerHTML = '';
  historyDiv.innerHTML = '';

  fetchCurrentSessions().then(function(currentSessions) {
    currentSessions.forEach(function(session) {
      removeInternalUrlsFromSession(session);
      const sessionEl = createSessionElement(session);
      if (firstSession) {
        currentDiv.appendChild(sessionEl);
        firstSession = false;
      } else {
        sessionsDiv.appendChild(sessionEl);
      }
    });
  });

  fetchSavedSessions().then(function(savedSessions) {
    savedSessions.forEach(function(session) {
      removeInternalUrlsFromSession(session);
      const sessionEl = createSessionElement(session);
      historyDiv.appendChild(sessionEl);
    });
  });

  importSessionActionEl.addEventListener('change', importSession, false);
  importSessionEl.onclick = function() {
    importSessionActionEl.click();
  };

  //hide incompatible sidebar items if in incognito mode
  if (chrome.extension.inIncognitoContext) {
    Array.prototype.forEach.call(
      document.getElementsByClassName('noIncognito'),
      function(el) {
        el.style.display = 'none';
      }
    );
  }
};

documentReadyAndLocalisedAsPromsied(document).then(function() {
  render();
});

reportPageView('history.html');
