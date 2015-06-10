/*global chrome */

(function () {

    'use strict';
    var tgs = chrome.extension.getBackgroundPage().tgs;

    var readyStateCheckInterval = window.setInterval(function () {
        if (document.readyState === 'complete') {

            window.clearInterval(readyStateCheckInterval);

            var noticeTextEl = document.getElementById('noticeText'),
                noticeTitleEl = document.getElementById('noticeTitle'),
                noticeObj = tgs.requestNotice();

            if (noticeObj.title) {
                noticeTitleEl.innerHTML = noticeObj.title;
            }
            if (noticeObj.text) {
                noticeTextEl.innerHTML = noticeObj.text;
            }
        }
    }, 50);

}());
