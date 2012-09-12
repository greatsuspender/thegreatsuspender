
chrome.extension.onMessage.addListener(
  function(request, sender, sendResponse) {
    	html2canvas([document.body], {
    		height: Math.min(document.body.offsetHeight, document.body.clientHeight * 3),
    		width: document.body.innerWidth,
    		proxy: false,
            onrendered: function( canvas ) {
                sendResponse({previewUrl: canvas.toDataURL('image/png')});
            }
        });
      	return true;
  }
);