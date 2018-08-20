/*global chrome */
(function() {
  'use strict';

  var tgs = chrome.extension.getBackgroundPage().tgs;
  var gsAnalytics = chrome.extension.getBackgroundPage().gsAnalytics;
  var gsStorage = chrome.extension.getBackgroundPage().gsStorage;
  var gsUtils = chrome.extension.getBackgroundPage().gsUtils;

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
})();
