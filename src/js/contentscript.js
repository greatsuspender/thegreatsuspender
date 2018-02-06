/*global chrome, html2canvas */
/*
 * The Great Suspender
 * Copyright (C) 2017 Dean Oemcke
 * Available under GNU GENERAL PUBLIC LICENSE v2
 * http://github.com/deanoemcke/thegreatsuspender
 * ლ(ಠ益ಠლ)
*/
(function () {
    'use strict';

    var inputState = false,
        tempWhitelist = false,
        timerJob,
        suspendDateTime = false;

    function suspendTab(suspendedUrl) {
        window.location.replace(suspendedUrl);
    }

    function setTimerJob(timeToSuspend) {
        suspendDateTime = new Date((new Date()).getTime() + timeToSuspend);

        return setTimeout(function () {
            //request suspension
            if (!inputState && !tempWhitelist) {
                chrome.runtime.sendMessage({ action: 'suspendTab' });
            }
        }, timeToSuspend);
    }

    function formInputListener(event) {
        if (!inputState && !tempWhitelist) {
            if (event.keyCode >= 48 && event.keyCode <= 90 && event.target.tagName) {
                if (event.target.tagName.toUpperCase() === 'INPUT' ||
                        event.target.tagName.toUpperCase() === 'TEXTAREA' ||
                        event.target.tagName.toUpperCase() === 'FORM' ||
                        event.target.isContentEditable === true) {
                    inputState = true;
                    chrome.runtime.sendMessage(buildReportTabStatePayload());
                }
            }
        }
    }

    //listen for background events
    chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {

        if (request.hasOwnProperty('action')) {
            if (request.action === 'confirmTabSuspend' && request.suspendedUrl) {
                sendResponse();
                suspendTab(request.suspendedUrl);
                return false;
            }
        }

        if (request.hasOwnProperty('ignoreForms')) {
            window.removeEventListener('keydown', formInputListener);
            if (request.ignoreForms) {
                window.addEventListener('keydown', formInputListener);
            }
            inputState = inputState && request.ignoreForms;
        }
        if (request.hasOwnProperty('tempWhitelist')) {
            if (inputState && !request.tempWhitelist) {
                inputState = false;
            }
            tempWhitelist = request.tempWhitelist;
        }
        if (request.hasOwnProperty('scrollPos')) {
            if (request.scrollPos !== '' && request.scrollPos !== '0') {
                document.body.scrollTop = request.scrollPos;
                document.documentElement.scrollTop = request.scrollPos;
            }
        }
        if (request.hasOwnProperty('suspendTime')) {
            clearTimeout(timerJob);
            var suspendTime = Number(request.suspendTime);
            if (!isNaN(suspendTime) && suspendTime > 0) {
                timerJob = setTimerJob(request.suspendTime * (1000 * 60));
            } else {
                suspendDateTime = false;
            }
        }
        sendResponse(buildReportTabStatePayload());
        return false;
    });

    function buildReportTabStatePayload(state) {
        return {
            action: 'reportTabState',
            status: state || (inputState ? 'formInput' : (tempWhitelist ? 'tempWhitelist' : 'normal')),
            scrollPos: document.body.scrollTop || document.documentElement.scrollTop || 0,
            timerUp: suspendDateTime ? suspendDateTime + '' : '-'
        };
    }
}());
