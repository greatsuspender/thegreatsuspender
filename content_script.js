
chrome.extension.onMessage.addListener(
    function(request, sender, sendResponse) {

        console.log('received request');

        var elementCount = document.getElementsByTagName("*").length;

        //safety check here. don't try to use html2canvas if the page has more than 5000 elements
        if (elementCount < 5000 && request.preview) {
          
            console.log('rendering with maxHeight:'+request.maxHeight+' format:'+request.format+' quality:'+request.quality);

            //allow max of 3 seconds to finish generating image (used to catch unexpected html2canvas failures)
            var processing = true;
            setTimeout(function() {
                if (processing) {
                    processing = false;
                    console.log('failed to render');
                    sendResponse({previewUrl: false});
                }
            },3000);

            html2canvas([document.body], {
                height: Math.min(document.body.offsetHeight, window.innerHeight * request.maxHeight) - 50,
                width: document.body.clientWidth - 10,
                proxy: false,
                onrendered: function( canvas ) {
                    if (processing) {
                        console.log('finished!');
                        processing = false;
                        sendResponse({previewUrl: canvas.toDataURL(request.format, request.quality), settings: request});
                    }
                }
            });


        } else {
            sendResponse({previewUrl: false, settings: request});
        }

        return true;
    }
);