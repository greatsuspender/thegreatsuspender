/*global chrome */
var historyUtils = (function() {
  // eslint-disable-line no-unused-vars
  'use strict';

  var gsStorage = chrome.extension.getBackgroundPage().gsStorage;
  var gsUtils = chrome.extension.getBackgroundPage().gsUtils;
  var noop = function() {};

  function importSession(e) {
    var f = e.target.files[0];
    if (f) {
      var r = new FileReader();
      r.onload = function(e) {
        var contents = e.target.result;
        if (f.type !== 'text/plain') {
          alert(chrome.i18n.getMessage('js_history_import_fail'));
        } else {
          handleImport(f.name, contents, function() {
            window.location.reload();
          });
        }
      };
      r.readAsText(f);
    } else {
      alert(chrome.i18n.getMessage('js_history_import_fail'));
    }
  }

  function handleImport(sessionName, textContents, callback) {
    callback = typeof callback !== 'function' ? noop : callback;

    var sessionId = '_' + gsUtils.generateHashCode(sessionName);
    var windows = [];

    var createNextWindow = function() {
      return {
        id: sessionId + '_' + windows.length,
        tabs: [],
      };
    };
    var curWindow = createNextWindow();

    textContents.split('\n').forEach(function(line) {
      if (typeof line !== 'string') {
        return;
      }
      if (line === '') {
        if (curWindow.tabs.length > 0) {
          windows.push(curWindow);
          curWindow = createNextWindow();
        }
        return;
      }
      if (line.indexOf('://') < 0) {
        return;
      }
      curWindow.tabs.push({
        windowId: curWindow.id,
        sessionId: sessionId,
        id: curWindow.id + '_' + curWindow.tabs.length,
        url: line,
        title: line,
        index: curWindow.tabs.length,
        pinned: false,
      });
    });
    if (curWindow.tabs.length > 0) {
      windows.push(curWindow);
    }

    sessionName = window.prompt(
      chrome.i18n.getMessage('js_history_enter_name_for_session'),
      sessionName
    );
    if (sessionName) {
      validateNewSessionName(sessionName, function(shouldSave) {
        if (shouldSave) {
          var session = {
            name: sessionName,
            sessionId: sessionId,
            windows: windows,
            date: new Date().toISOString(),
          };
          gsStorage.updateSession(session, function() {
            callback();
          });
        }
      });
    }
  }

  function exportSession(sessionId, callback) {
    callback = typeof callback !== 'function' ? noop : callback;

    var content = 'data:text/plain;charset=utf-8,',
      dataString = '';

    gsStorage.fetchSessionBySessionId(sessionId).then(function(session) {
      if (!session || !session.windows) {
        callback();
      }

      session.windows.forEach(function(curWindow, index) {
        curWindow.tabs.forEach(function(curTab, tabIndex) {
          if (gsUtils.isSuspendedTab(curTab)) {
            dataString += gsUtils.getSuspendedUrl(curTab.url) + '\n';
          } else {
            dataString += curTab.url + '\n';
          }
        });
        //add an extra newline to separate windows
        dataString += '\n';
      });
      content += dataString;

      var encodedUri = encodeURI(content);
      var link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', 'session.txt');
      link.click();
      callback();
    });
  }

  function validateNewSessionName(sessionName, callback) {
    gsStorage.fetchSavedSessions().then(function(savedSessions) {
      var nameExists = savedSessions.some(function(savedSession, index) {
        return savedSession.name === sessionName;
      });
      if (nameExists) {
        var overwrite = window.confirm(
          chrome.i18n.getMessage('js_history_confirm_session_overwrite')
        );
        if (!overwrite) {
          callback(false);
          return;
        }
      }
      callback(true);
    });
  }

  function saveSession(sessionId) {
    gsStorage.fetchSessionBySessionId(sessionId).then(function(session) {
      var sessionName = window.prompt(
        chrome.i18n.getMessage('js_history_enter_name_for_session')
      );
      if (sessionName) {
        historyUtils.validateNewSessionName(sessionName, function(shouldSave) {
          if (shouldSave) {
            session.name = sessionName;
            gsStorage.addToSavedSessions(session, function() {
              window.location.reload();
            });
          }
        });
      }
    });
  }

  return {
    importSession: importSession,
    exportSession: exportSession,
    validateNewSessionName: validateNewSessionName,
    saveSession: saveSession,
  };
})();
