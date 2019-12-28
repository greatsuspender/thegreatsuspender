let gsGlobals;
try {
  gsGlobals = chrome.extension.getBackgroundPage().gsGlobals;
  if (!gsGlobals) throw new Error();
} catch (e) {
  window.setTimeout(() => window.location.reload(), 1000);
  return;
}

const { documentReadyAndLocalisedAsPromsied, hasProperty } = gsGlobals.gsUtils;
const { setNoticeVersion } = gsGlobals.gsStorage;
const { reportPageView } = gsGlobals.gsAnalytics;
const { requestNotice, clearNotice } = gsGlobals.gsTgs;

documentReadyAndLocalisedAsPromsied(document).then(function() {
  const notice = requestNotice();
  if (notice && hasProperty(notice, 'text') && hasProperty(notice, 'version')) {
    const noticeContentEl = document.getElementById('gsNotice');
    noticeContentEl.innerHTML = notice.text;
    //update local notice version
    setNoticeVersion(notice.version);
  }

  //clear notice (to prevent it showing again)
  clearNotice();
});
reportPageView('notice.html');
