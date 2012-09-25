
chrome.extension.onMessage.addListener(
    function(request, sender, sendResponse) {

        try {

            if (request.preview) {
              
                console.log('rendering with maxHeight:'+request.maxHeight+' format:'+request.format+' quality:'+request.quality);

                html2canvas([document.body], {
                    height: Math.min(document.body.offsetHeight, window.innerHeight * request.maxHeight) - 50,
                    width: document.body.clientWidth - 10,
                    proxy: false,
                        onrendered: function( canvas ) {
                            console.log('finished!');
                            sendResponse({previewUrl: canvas.toDataURL(request.format, request.quality), settings: request});
                        }
                    });

            } else {
                sendResponse({previewUrl: false, settings: request});
            }
        } catch(e) {
            console.log('failed to render');
            sendResponse({previewUrl: false});
        }

        return true;
    }
);