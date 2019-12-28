let gsGlobals;
try {
  gsGlobals = chrome.extension.getBackgroundPage().gsGlobals;
  if (!gsGlobals) throw new Error();
} catch (e) {
  window.setTimeout(() => window.location.reload(), 1000);
  return;
}

const { documentReadyAndLocalisedAsPromsied } = gsGlobals.gsUtils;
const { buildCurrentSession } = gsGlobals.gsSession;
const { tabsCreate } = gsGlobals.gsChrome;
const { exportSession } = gsGlobals.gsHistoryUtils;
const { reportPageView } = gsGlobals.gsAnalytics;

documentReadyAndLocalisedAsPromsied(document).then(function() {
  document.getElementById('exportBackupBtn').onclick = async function(e) {
    const currentSession = await buildCurrentSession();
    exportSession(currentSession, function() {
      document.getElementById('exportBackupBtn').style.display = 'none';
    });
  };
  document.getElementById('setFilePermissiosnBtn').onclick = async function(e) {
    await tabsCreate({
      url: 'chrome://extensions?id=' + chrome.runtime.id,
    });
  };
});
reportPageView('permissions.html');
