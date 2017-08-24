/*global chrome */
(function () {
    'use strict';

    var tgs = chrome.extension.getBackgroundPage().tgs;
    var gsUtils = chrome.extension.getBackgroundPage().gsUtils;

    gsUtils.documentReadyAndLocalisedAsPromsied(document).then(function () {

        var noticeTextEl = document.getElementById('noticeText'),
            noticeTitleEl = document.getElementById('noticeTitle'),
            noticeObj = tgs.requestNotice();

        if (noticeObj.title) {
            noticeTitleEl.innerHTML = noticeObj.title;
        }
        if (noticeObj.text) {
            noticeTextEl.innerHTML = noticeObj.text;
        }
    });
}());
