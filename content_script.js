/*global chrome, document, window, console, html2canvas */

(function () {

    "use strict";

    chrome.extension.onMessage.addListener(
        function (request, sender, sendResponse) {

            //console.log('received request');

            var elementCount = document.getElementsByTagName("*").length,
                processing = true;

            //safety check here. don't try to use html2canvas if the page has more than 5000 elements
            if (elementCount < 5000) {

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
                                sendResponse({previewUrl: canvas.toDataURL()});
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

            return true;
        }
    );
}());