/*global chrome */
(function () {
    'use strict';

    var tgs = chrome.extension.getBackgroundPage().tgs;
    var gsAnalytics = chrome.extension.getBackgroundPage().gsAnalytics;
    var gsStorage = chrome.extension.getBackgroundPage().gsStorage;
    var gsUtils = chrome.extension.getBackgroundPage().gsUtils;

    gsUtils.documentReadyAndLocalisedAsPromsied(document).then(function () {
        var notice = tgs.requestNotice();
        var noticeContentEl = document.getElementById('gsNotice');
        noticeContentEl.innerHTML = notice.text;

        //clear notice (to prevent it showing again)
        tgs.clearNotice();

        //update local notice version
        gsStorage.setNoticeVersion(notice.version);
    });
    gsAnalytics.reportPageView('notice.html');
}());
