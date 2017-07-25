/*global chrome, html2canvas */
/*
 * The Great Suspender
 * Copyright (C) 2015 Dean Oemcke
 * Available under GNU GENERAL PUBLIC LICENSE v2
 * http://github.com/deanoemcke/thegreatsuspender
 * ლ(ಠ益ಠლ)
*/

(function () {
    'use strict';

    var readyStateCheckInterval,
        inputState = false,
        tempWhitelist = false,
        timerJob,
        suspendDateTime = false,
        suspendedEl = document.getElementById('gsTopBar');

    //safety check here. don't load content script if we are on the suspended page
    if (suspendedEl) { return; }

    function init() {

        //do startup jobs
        var tabState = buildTabStateObject();
        chrome.runtime.sendMessage({ action: 'initTab' }, function (response) {

            //set timer job
            if (response && response.suspendTime > 0) {

                var suspendTime = response.suspendTime * (1000*60);
                timerJob = setTimerJob(suspendTime);
            }

            //add form input listener
            if (response && response.dontSuspendForms) {
                window.addEventListener('keydown', formInputListener);
            }

            //handle auto-scrolling
            if (response && response.scrollPos && response.scrollPos !== "" && response.scrollPos !== "0") {
                document.body.scrollTop = response.scrollPos;
            }
        });
        chrome.runtime.sendMessage(tabState);
    }

    function calculateState() {
        var status = inputState ? 'formInput' : (tempWhitelist ? 'tempWhitelist' : 'normal');
        return status;
    }

    function buildTabStateObject(state) {
        return {
            action: 'reportTabState',
            status: state || calculateState(),
            scrollPos: document.body.scrollTop,
            timerUp: suspendDateTime ? suspendDateTime + '' : '-'
        };
    }

    function suspendTab(suspendedUrl) {

        var tabState = buildTabStateObject('suspended');
        chrome.runtime.sendMessage(tabState);

        if (suspendedUrl.indexOf('suspended.html') > 0) {
            window.location.replace(suspendedUrl);
        } else {
            window.location.href = suspendedUrl;
        }
    }

    function handlePreviewError(suspendedUrl, err) {
        chrome.runtime.sendMessage({
            action: 'savePreviewData',
            previewUrl: false,
            errorMsg: err
        });
        suspendTab(suspendedUrl);
    }

    function generatePreviewImg(suspendedUrl, screenCapture) {
        var elementCount = document.getElementsByTagName('*').length,
            processing = true,
            timer = new Date(),
            height = 0;

        //safety check here. don't try to use html2canvas if the page has more than 10000 elements
        if (elementCount < 10000) {

            //allow max of 30 seconds to finish generating image
            window.setTimeout(function () {
                if (processing) {
                    processing = false;
                    handlePreviewError(suspendedUrl, '30sec timeout reached');
                }
            }, 30000);

            //check where we need to capture the whole screen
            if (screenCapture === '2') {
                height = Math.max(document.body.scrollHeight,
                    document.body.offsetHeight,
                    document.documentElement.clientHeight,
                    document.documentElement.scrollHeight,
                    document.documentElement.offsetHeight);
                // cap the max height otherwise it fails to convert to a data url
                height = Math.min(height, 10000);
            } else {
                height = Math.min(document.body.offsetHeight, window.innerHeight);
            }

            html2canvas(document.body,{
                height: height,
                width: document.body.clientWidth,
                imageTimeout: 1000,
                onrendered: function(canvas) {
                    if (processing) {
                        processing = false;
                        timer = (new Date() - timer) / 1000;
                        console.log('canvas: ' + canvas);
                        var dataUrl = canvas.toDataURL('image/webp', 0.8);
                        console.log('dataUrl: ' + dataUrl);
                        chrome.runtime.sendMessage({
                            action: 'savePreviewData',
                            previewUrl: dataUrl,
                            timerMsg: timer
                        }, function () {
                            suspendTab(suspendedUrl);
                        });
                    }
                }
            });

        } else {
            handlePreviewError(suspendedUrl, 'element count > 5000');
        }
    }

    function setTimerJob(timeToSuspend) {

        //slightly randomise suspension timer to spread the cpu load when multiple tabs all suspend at once
        if (timeToSuspend > (1000*60)) {
            timeToSuspend = timeToSuspend + parseInt((Math.random() * 1000*60), 10);
        }

        //safety check to make sure timeToSuspend is reasonable
        if (timeToSuspend < (1000*10)) {
            timeToSuspend = (1000*60*60);
        }

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
                if (event.target.tagName.toUpperCase() === 'INPUT'
                  || event.target.tagName.toUpperCase() === 'TEXTAREA'
                  || event.target.tagName.toUpperCase() === 'FORM') {
                    inputState = true;
                    var tabState = buildTabStateObject();
                    chrome.runtime.sendMessage(tabState);
                }
            }
        }
    }

    //listen for background events
    chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
        var response = {},
            status;

        //console.dir('received contentscript.js message:' + request.action + ' [' + Date.now() + ']');

        switch (request.action) {

        //listen for request to reset preferences if options have changed
        case 'resetPreferences':
            if (request.hasOwnProperty('suspendTime')) {
                clearTimeout(timerJob);
                if (request.suspendTime > 0) {
                    timerJob = setTimerJob(request.suspendTime * (1000*60));
                } else {
                    suspendDateTime = false;
                }
            }
            if (request.hasOwnProperty('ignoreForms')) {
                window.removeEventListener('keydown', formInputListener);
                if (request.ignoreForms) {
                    window.addEventListener('keydown', formInputListener);
                }
                inputState = inputState && request.ignoreForms;
            }
            break;

        //listen for status request
        case 'requestInfo':
            //console.log(suspendDateString);
            sendResponse(buildTabStateObject());
            break;

        //cancel suspension timer job
        case 'cancelTimer':
            clearTimeout(timerJob);
            suspendDateTime = false;
            break;

        //listen for request to temporarily whitelist the tab
        case 'tempWhitelist':
            status = inputState ? 'formInput' : (tempWhitelist ? 'tempWhitelist' : 'normal');
            response = {status: status};
            tempWhitelist = true;
            break;

        //listen for request to undo temporary whitelisting
        case 'undoTempWhitelist':
            inputState = false;
            tempWhitelist = false;
            response = {status: 'normal'};
            break;

        //listen for preview request
        case 'generatePreview':
            generatePreviewImg(request.suspendedUrl, request.screenCapture);
            break;

        //listen for suspend request
        case 'confirmTabSuspend':
            if (request.suspendedUrl) {
                suspendTab(request.suspendedUrl);
            }
            break;
        }
    });

    readyStateCheckInterval = window.setInterval(function () {
        if (document.readyState === 'complete') {
            window.clearInterval(readyStateCheckInterval);
            init();
        }
    }, 50);

}());
