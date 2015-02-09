/*global chrome, html2canvas */

(function () {

    'use strict';

    chrome.runtime.onMessage.addListener(
        function (request, sender, sendResponse) {
            console.dir('received previewscript.js message:' + request.action + ' [' + Date.now() + ']');
            if (request.action === 'suspendTabWithPreview') {
                //console.log('received request');

                var elementCount = document.getElementsByTagName('*').length,
                    suspendedEl = document.getElementById('gsTopBar'),
                    processing = true;

                //safety check here. don't try to use html2canvas if the page has more than 5000 elements
                //or if page has already been suspended
                if (suspendedEl || elementCount < 5000) {
                    //allow max of 3 seconds to finish generating image (used to catch unexpected html2canvas failures)
                    window.setTimeout(function () {
                        if (processing) {
                            processing = false;
                            console.error('failed to render');
                            sendResponse({});
                        }
                    }, 3000);

                    try {
                        html2canvas([document.body], {
                            height: Math.min(document.body.offsetHeight, window.innerHeight) - 125,
                            width: document.body.clientWidth - 6,
                            proxy: false,
                            onrendered: function (canvas) {
                                if (processing) {
                                    processing = false;
                                    var quality = request.quality || 0.1;
                                    sendResponse({previewUrl: canvas.toDataURL('image/jpeg', quality)});
                                }
                            }
                        });
                    } catch (ex) {
                        console.error('failed to render');
                        sendResponse({});
                    }
                } else {
                    console.error('too many page elements');
                    sendResponse({});
                }
            }
            return true;
        }
    );
}());
