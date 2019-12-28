import {
  warning,
  generateHashCode,
  isSuspendedTab,
  getOriginalUrl,
} from './gsUtils';
import {
  fetchTabInfo,
  updateSession,
  fetchSessionBySessionId,
  fetchSavedSessions,
  addToSavedSessions,
} from './gsIndexedDb';

export const importSession = e => {
  const f = e.target.files[0];
  if (f) {
    const r = new FileReader();
    r.onload = function(e) {
      const contents = e.target.result;
      if (f.type !== 'text/plain') {
        alert(chrome.i18n.getMessage('js_history_import_fail'));
      } else {
        handleImport(f.name, contents).then(function() {
          window.location.reload();
        });
      }
    };
    r.readAsText(f);
  } else {
    alert(chrome.i18n.getMessage('js_history_import_fail'));
  }
};

const handleImport = async (sessionName, textContents) => {
  sessionName = window.prompt(
    chrome.i18n.getMessage('js_history_enter_name_for_session'),
    sessionName
  );
  if (sessionName) {
    const shouldSave = await new Promise(resolve => {
      validateNewSessionName(sessionName, function(result) {
        resolve(result);
      });
    });
    if (!shouldSave) {
      return;
    }

    const sessionId = '_' + generateHashCode(sessionName);
    const windows = [];

    const createNextWindow = function() {
      return {
        id: sessionId + '_' + windows.length,
        tabs: [],
      };
    };
    let curWindow = createNextWindow();

    for (const line of textContents.split('\n')) {
      if (typeof line !== 'string') {
        continue;
      }
      if (line === '') {
        if (curWindow.tabs.length > 0) {
          windows.push(curWindow);
          curWindow = createNextWindow();
        }
        continue;
      }
      if (line.indexOf('://') < 0) {
        continue;
      }
      const tabInfo = {
        windowId: curWindow.id,
        sessionId: sessionId,
        id: curWindow.id + '_' + curWindow.tabs.length,
        url: line,
        title: line,
        index: curWindow.tabs.length,
        pinned: false,
      };
      const savedTabInfo = await fetchTabInfo(line);
      if (savedTabInfo) {
        tabInfo.title = savedTabInfo.title;
        tabInfo.favIconUrl = savedTabInfo.favIconUrl;
      }
      curWindow.tabs.push(tabInfo);
    }
    if (curWindow.tabs.length > 0) {
      windows.push(curWindow);
    }

    const session = {
      name: sessionName,
      sessionId: sessionId,
      windows: windows,
      date: new Date().toISOString(),
    };
    await updateSession(session);
  }
};

export const exportSessionWithId = (sessionId, callback) => {
  callback =
    typeof callback !== 'function'
      ? () => {
          //noop
        }
      : callback;

  fetchSessionBySessionId(sessionId).then(function(session) {
    if (!session || !session.windows) {
      callback();
    } else {
      exportSession(session, callback);
    }
  });
};

export const exportSession = (session, callback) => {
  let sessionString = '';

  session.windows.forEach(function(curWindow) {
    curWindow.tabs.forEach(function(curTab) {
      if (isSuspendedTab(curTab)) {
        sessionString += getOriginalUrl(curTab.url) + '\n';
      } else {
        sessionString += curTab.url + '\n';
      }
    });
    //add an extra newline to separate windows
    sessionString += '\n';
  });

  const blob = new Blob([sessionString], { type: 'text/plain' });
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', blobUrl);
  link.setAttribute('download', 'session.txt');
  link.click();

  callback();
};

const validateNewSessionName = (sessionName, callback) => {
  fetchSavedSessions().then(function(savedSessions) {
    const nameExists = savedSessions.some(function(savedSession) {
      return savedSession.name === sessionName;
    });
    if (nameExists) {
      const overwrite = window.confirm(
        chrome.i18n.getMessage('js_history_confirm_session_overwrite')
      );
      if (!overwrite) {
        callback(false);
        return;
      }
    }
    callback(true);
  });
};

export const saveSession = sessionId => {
  fetchSessionBySessionId(sessionId).then(function(session) {
    if (!session) {
      warning(
        'historyUtils',
        'Could not find session with sessionId: ' + sessionId + '. Save aborted'
      );
      return;
    }
    const sessionName = window.prompt(
      chrome.i18n.getMessage('js_history_enter_name_for_session')
    );
    if (sessionName) {
      validateNewSessionName(sessionName, function(shouldSave) {
        if (shouldSave) {
          session.name = sessionName;
          addToSavedSessions(session).then(function() {
            window.location.reload();
          });
        }
      });
    }
  });
};
