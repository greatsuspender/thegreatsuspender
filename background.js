
function generatePage(tab, previewUrl, faviconUrl) {

    var expiryDate = (new Date()).setSeconds((new Date()).getSeconds() + 10);
    var html = '<title>' + tab.title + '</title>';
    html += '<script type="text/javascript" >';
    html += 'if (new Date() > ' + expiryDate + ') { history.back(); }';
    html += 'document.onclick = function(){ history.back(); };';
    html += '</script>';
    html += '<link rel="icon" href="' + faviconUrl + '" />'
    html += '<a href="' + tab.url + '">';
    if (previewUrl !== '') {
        html += '<img src="' + previewUrl + '" style="padding-top:40px;" />';
    }
    html += '<div class="reloadNote" style="position: fixed;' +
                    'color: #444;' +
                    'text-shadow: 0 1px 0 #FFF3C5;' +
                    'height: 40px;' +
                    'background: #FDE073;' +
                    'top: 0;' +
                    'line-height: 40px;' +
                    'width: 100%;' +
                    'text-align: center;' +
                    'font-family: verdana, arial, sans-serif;' +
                    'border-bottom: 1px solid #6B5811;' +
                    'box-shadow: 0 4px 5px -2px #555;">Tab suspended. Click to reload.' +
            '</div>';
    html += '</a>';
    html = html.replace(/\s{2,}/g, '')   // <-- Replace all consecutive spaces, 2+
       .replace(/%/g, '%25')     // <-- Escape %
       .replace(/&/g, '%26')     // <-- Escape &
       .replace(/#/g, '%23')     // <-- Escape #
       .replace(/"/g, '%22')     // <-- Escape "
       .replace(/'/g, '%27');    // <-- Escape ' (to be 100% safe)
    var dataURI = 'data:text/html,' + html;
      
    console.log('tab.id'+ tab.id +' :: generating placeholder page');
    chrome.tabs.update(tab.id, {url:dataURI});

}

function suspendTab(tab) {
    
    var preview = localStorage["preview"] === "true" ? true : false;

    if (preview) {
        chrome.tabs.executeScript(tab.id, {file: "html2canvas.min.js"}, function() {
            sendSuspendMessage(tab, preview);
        }); 
    } else {
        sendSuspendMessage(tab, preview);
    }
       
}

function killTab(tab, previewUrl, faviconUrl) {

    var count = 0;
    chrome.tabs.update(tab.id, {url:"chrome://kill"});
    var testLoaded = function() {
        chrome.tabs.get(tab.id, function(killTab) {
            console.log('tab.id'+ tab.id +' :: '+killTab.status);
            if (killTab.status === 'complete') {
                generatePage(tab, previewUrl, faviconUrl);
                
            } else {
                count++;
                //only try for 50 * 0.1 seconds
                if (count < 50) {
                    setTimeout(testLoaded, 100);
                }
            }
        });
    }
    testLoaded();
}

function generateFaviconUri(url, callback) {

    var img = new Image;
    img.onload = function(){
        var canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        var context = canvas.getContext("2d");
        context.globalAlpha = 0.5;
        context.drawImage(img, 0, 0);
/*        context.globalCompositeOperation = "darker";
        context.fillStyle = "#000";
        context.fillRect(0, 0, img.width, img.height);
        context.fill();
*/        callback(canvas.toDataURL());
    };
    url ? img.src = url : callback('');

}

function sendSuspendMessage(tab, preview) {

    chrome.tabs.executeScript(tab.id, {file: "content_script.js"}, function() {


        var maxHeight = localStorage["maxHeight"] ? localStorage["maxHeight"] : 2;
        var format = localStorage["format"] ? localStorage["format"] : 'image/png';
        var quality = localStorage["quality"] ? +localStorage["quality"] : 0.6;
    
        console.log('tab.id'+tab.id + " :: " +'sending message...');
        
        var previewUrl = false;
        var faviconUrl = false;

        chrome.tabs.sendMessage(tab.id, {preview:preview, maxHeight:maxHeight, format:format, quality:quality}, function(response) {
            previewUrl = response ? response.previewUrl : '';
            if (faviconUrl !== false) {killTab(tab, previewUrl, faviconUrl);}
        });

        generateFaviconUri(tab.favIconUrl, function(response) {
            faviconUrl = response;
            if (previewUrl !== false) {killTab(tab, previewUrl, faviconUrl);}
        });
    });   
}

function suspendOne() {

   chrome.windows.getCurrent({populate:true}, function(window) {
        var i;
        for (i=0; i < window.tabs.length; i += 1) {
            if (window.tabs[i].active) {
                suspendTab(window.tabs[i]);
            }
        }
    });
}
function suspendAll() {

    chrome.windows.getCurrent({populate:true}, function(window) {
        var i;
        for (i=0; i < window.tabs.length; i += 1) {
            if (window.tabs[i].url.indexOf("data") != 0 &&  window.tabs[i].url.indexOf("chrome") != 0) {
                console.log("tab.id"+window.tabs[i].id + " :: " +window.tabs[i].url);
                suspendTab(window.tabs[i]);
            }
        }
    });
}
function unsuspendAll() {

    chrome.windows.getCurrent({populate:true}, function(window) {
        var i;
        for (i=0; i < window.tabs.length; i += 1) {
            if (window.tabs[i].url.indexOf("data") === 0) {
                chrome.tabs.update(window.tabs[i].id, {url:window.tabs[i].url});

            } else if (window.tabs[i].url.indexOf("chrome://kill/") === 0) {
                chrome.tabs.reload(window.tabs[i].id);
            }
        }
    })
;}

chrome.extension.onRequest.addListener(
    function(request, sender, sendResponse){
        if(request.msg == "suspendOne") suspendOne();
        if(request.msg == "suspendAll") suspendAll();
        if(request.msg == "unsuspendAll") unsuspendAll();
    }
);
