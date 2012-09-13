
chrome.extension.onMessage.addListener(
  function(request, sender, sendResponse) {

      console.log('maxHeight:'+sender.maxHeight+' format:'+sender.format+'quality:'+sender.quality);

    	html2canvas([document.body], {
    		height: Math.min(document.body.offsetHeight, window.innerHeight * sender.maxHeight),
    		width: document.body.clientWidth - 15,
    		proxy: false,
            onrendered: function( canvas ) {
                sendResponse({previewUrl: canvas.toDataURL(sender.format, sender.quality)});
            }
        });
      	return true;
  }
);