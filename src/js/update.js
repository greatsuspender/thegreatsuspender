let gsGlobals;
try {
  gsGlobals = chrome.extension.getBackgroundPage().gsGlobals;
  if (!gsGlobals) throw new Error();
} catch (e) {
  window.setTimeout(() => window.location.reload(), 1000);
  return;
}

const { warning, documentReadyAndLocalisedAsPromsied } = gsGlobals.gsUtils;
const {
  fetchSessionRestorePoint,
  createOrUpdateSessionRestorePoint,
} = gsGlobals.gsIndexedDb;
const {
  buildCurrentSession,
  unsuspendActiveTabInEachWindow,
  updateCurrentSession,
} = gsGlobals.gsSession;
const { exportSession } = gsGlobals.gsHistoryUtils;

function setRestartExtensionClickHandler() {
  document.getElementById('restartExtensionBtn').onclick = async function() {
    // const result = true;
    // if (warnFirst) {
    //   result = window.confirm(chrome.i18n.getMessage('js_update_confirm'));
    // }
    // if (result) {

    document.getElementById('restartExtensionBtn').className += ' btnDisabled';
    document.getElementById('restartExtensionBtn').onclick = null;

    const currentSession = await buildCurrentSession();
    if (currentSession) {
      const currentVersion = chrome.runtime.getManifest().version;
      await createOrUpdateSessionRestorePoint(currentSession, currentVersion);
    }

    //ensure we don't leave any windows with no unsuspended tabs
    await unsuspendActiveTabInEachWindow();

    //update current session to ensure the new tab ids are saved before
    //we restart the extension
    await updateCurrentSession();

    chrome.runtime.reload();
    // }
  };
}

function setExportBackupClickHandler() {
  document.getElementById('exportBackupBtn').onclick = async function() {
    const currentSession = await buildCurrentSession();
    exportSession(currentSession, function() {
      document.getElementById('exportBackupBtn').style.display = 'none';
      setRestartExtensionClickHandler(false);
    });
  };
}

function setSessionManagerClickHandler() {
  document.getElementById('sessionManagerLink').onclick = function(e) {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.extension.getURL('history.html') });
    setRestartExtensionClickHandler(false);
  };
}

documentReadyAndLocalisedAsPromsied(document).then(function() {
  setSessionManagerClickHandler();
  setRestartExtensionClickHandler(true);
  setExportBackupClickHandler();

  const currentVersion = chrome.runtime.getManifest().version;
  fetchSessionRestorePoint(currentVersion).then(function(sessionRestorePoint) {
    if (!sessionRestorePoint) {
      warning(
        'update',
        'Couldnt find session restore point. Something has gone horribly wrong!!'
      );
      document.getElementById('noBackupInfo').style.display = 'block';
      document.getElementById('backupInfo').style.display = 'none';
      document.getElementById('exportBackupBtn').style.display = 'none';
    }
  });
});
