/*global chrome, tgs, gsAnalytics, gsStorage, gsUtils */
(function(global) {
  'use strict';

  const backgroundPage = chrome.extension.getBackgroundPage();
  if (!backgroundPage || !backgroundPage.tgs) {
    setTimeout(() => location.replace(location.href), 1000);
    return;
  }
  backgroundPage.tgs.setViewGlobals(global, 'notice');

  gsUtils.documentReadyAndLocalisedAsPromsied(document).then(function() {
    var notice = tgs.requestNotice();
    if (
      notice &&
      notice.hasOwnProperty('text') &&
      notice.hasOwnProperty('version')
    ) {
      var noticeContentEl = document.getElementById('gsNotice');
      noticeContentEl.innerHTML = notice.text;
      //update local notice version
      gsStorage.setNoticeVersion(notice.version);
    }

    //clear notice (to prevent it showing again)
    tgs.clearNotice();
  });
  gsAnalytics.reportPageView('notice.html');
})(this);
