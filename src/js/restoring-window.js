let gsGlobals;
try {
  gsGlobals = chrome.extension.getBackgroundPage().gsGlobals;
  if (!gsGlobals) throw new Error();
} catch (e) {
  window.setTimeout(() => window.location.reload(), 1000);
  return;
}

const { documentReadyAndLocalisedAsPromsied } = gsGlobals.gsUtils;
const { reportPageView } = gsGlobals.gsAnalytics;

documentReadyAndLocalisedAsPromsied(document).then(function() {
  //do nothing
});
reportPageView('restoring-window.html');
