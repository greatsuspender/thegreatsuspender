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

    var inputState = false,
        tempWhitelist = false,
        timer,
        timerUp = false,
        suspendTime,
        suspendedEl = document.getElementById('gsTopBar');

    //safety check here. don't load content script if we are on the suspended page
    if (suspendedEl) { return; }

    function calculateState() {
        var status = inputState ? 'formInput' : (tempWhitelist ? 'tempWhitelist' : 'normal');
        return status;
    }

    function reportState(state) {
        state = state || calculateState();
        chrome.runtime.sendMessage({ action: 'reportTabState', status: state });
    }

    function suspendTab(suspendedUrl) {

        reportState('suspended');

        if (suspendedUrl.indexOf('suspended.html') > 0) {
            window.location.replace(suspendedUrl);
        } else {
            window.location.href = suspendedUrl;
        }
    }

    function setScrollPos(reset) {
        reset = reset || false;
        var val = reset ? '' : document.body.scrollTop;
        document.cookie = "gsScrollPos=" + val;
    }

    function getScrollPos() {

        var key = "gsScrollPos=",
            keyStart = document.cookie.indexOf(key),
            keyEnd;
        if (keyStart >= 0) {
            keyEnd = document.cookie.indexOf(';', keyStart) > 0 ? document.cookie.indexOf(';', keyStart) : document.cookie.length;
            return document.cookie.substring(keyStart + key.length, keyEnd);
        } else {
            return 50;
        }
    }

    function handlePreviewError(suspendedUrl) {
        console.error('failed to render');
        chrome.runtime.sendMessage({
            action: 'savePreviewData',
            previewUrl: false
        });
        suspendTab(suspendedUrl);
    }

    function generatePreviewImg(suspendedUrl, previewQuality) {
        var elementCount = document.getElementsByTagName('*').length,
            processing = true;

        setScrollPos();

        //safety check here. don't try to use html2canvas if the page has more than 5000 elements
        if (elementCount < 5000) {

            //allow max of 3 seconds to finish generating image (used to catch unexpected html2canvas failures)
            window.setTimeout(function () {
                if (processing) {
                    processing = false;
                    handlePreviewError(suspendedUrl);
                }
            }, 3000);

            try {
                html2canvas(document.body,{
                    height: Math.min(document.body.offsetHeight, window.innerHeight) - 125,
                    width: document.body.clientWidth - 6,
                    imageTimeout: 500,
                    proxy: false
                    }).then(function(canvas) {

                    if (processing) {
                        processing = false;
                        var quality =  previewQuality || 0.1;
                        chrome.runtime.sendMessage({
                            action: 'savePreviewData',
                            previewUrl: canvas.toDataURL('image/jpeg', quality)
                        });
                        suspendTab(suspendedUrl);
                    }
                });
            } catch (ex) {
                handlePreviewError(suspendedUrl);
            }

        } else {
            handlePreviewError(suspendedUrl);
        }
    }

    function setTimerJob(interval) {

        //slightly randomise suspension timer to spread the cpu load when multiple tabs all suspend at once
        if (interval > 4) {
            interval = interval + (Math.random() * 60 * 1000);
        }
        timerUp = new Date((new Date()).getTime() + interval);

        return setTimeout(function () {
            //request suspension
            if (!inputState && !tempWhitelist) {

                chrome.runtime.sendMessage({ action: 'suspendTab' });
            }
        }, interval);
    }

    function setFormInputJob() {
        window.addEventListener('keydown', function (event) {
            if (!inputState && !tempWhitelist) {
                if (event.keyCode >= 48 && event.keyCode <= 90 && event.target.tagName) {
                    if (event.target.tagName.toUpperCase() === 'INPUT'
                            || event.target.tagName.toUpperCase() === 'TEXTAREA'
                            || event.target.tagName.toUpperCase() === 'FORM') {
                        inputState = true;
                    }
                }
            }
        });
    }

    function requestPreferences(callback) {
        chrome.runtime.sendMessage({ action: 'prefs' }, function (response) {
            callback(response);
        });
    }


    //listen for background events
    chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
        var response = {},
            status,
            suspendDate;

        //console.dir('received contentscript.js message:' + request.action + ' [' + Date.now() + ']');

        switch (request.action) {
        case 'resetTimer':
            clearTimeout(timer);
            if (request.suspendTime > 0) {
                suspendTime = request.suspendTime * 60 * 1000;
                timer = setTimerJob(suspendTime);
            } else {
                timerUp = false;
                suspendTime = 0;
            }
            break;

        //listen for status request
        case 'requestInfo':
            status = calculateState();
            suspendDate = timerUp ? timerUp + '' : '-';
            //console.log(suspendDate);
            response = { status: status, timerUp: suspendDate };
            sendResponse(response);
            break;

        //cancel suspension timer
        case 'cancelTimer':
            clearTimeout(timer);
            timerUp = false;
            break;

        //listen for request to temporarily whitelist the tab
        case 'tempWhitelist':
            status = inputState ? 'formInput' : (tempWhitelist ? 'tempWhitelist' : 'normal');
            response = {status: status};
            tempWhitelist = true;
            reportState(false);
            sendResponse(response);
            break;

        //listen for request to undo temporary whitelisting
        case 'undoTempWhitelist':
            inputState = false;
            tempWhitelist = false;
            response = {status: 'normal'};
            reportState(false);
            sendResponse(response);
            break;

        //listen for preview request
        case 'generatePreview':
            generatePreviewImg(request.suspendedUrl, request.previewQuality);
            break;

        //listen for suspend request
        case 'confirmTabSuspend':
            if (request.suspendedUrl) {
                setScrollPos();
                suspendTab(request.suspendedUrl);
            }
            break;

        default:
            break;
        }
    });

    //do startup jobs
    reportState(false);
    requestPreferences(function(response) {

        if (response && response.suspendTime > 0) {

            suspendTime = response.suspendTime * 60 * 1000;

            //set timer job
            timer = setTimerJob(suspendTime);

            //add form input listener
            if (response.dontSuspendForms) {
                setFormInputJob();
            }

        } else {
            suspendTime = 0;
        }
    });

    window.onload = function() {
        var scrollPos = getScrollPos();
        if (scrollPos && scrollPos !== "") {
            document.body.scrollTop = scrollPos;
            setScrollPos(true);
        }

    };

}());
