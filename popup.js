
function generatePage(tab, previewUrl) {

    var html = '<title>' + tab.title + '</title>';
    html += '<link rel="icon" href="' + tab.favIconUrl + '" />'
    if (previewUrl) {
        html += 
        '<a href="' + tab.url + '"><img src="' + previewUrl + '" />' +
        '<div class="reloadNote" style="position: fixed;' +
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
        '</div></a>';
    } else {
        html += '<a href="' + tab.url + '">click to reload</a>'
    }
    html = html.replace(/\s{2,}/g, '')   // <-- Replace all consecutive spaces, 2+
       .replace(/%/g, '%25')     // <-- Escape %
       .replace(/&/g, '%26')     // <-- Escape &
       .replace(/#/g, '%23')     // <-- Escape #
       .replace(/"/g, '%22')     // <-- Escape "
       .replace(/'/g, '%27');    // <-- Escape ' (to be 100% safe)
    var dataURI = 'data:text/html,' + html;
      
    chrome.tabs.update(tab.id, {url:dataURI});

}

function suspendTab(tab) {
    
    var maxHeight = localStorage["maxHeight"] ? localStorage["maxHeight"] : 2;
    var format = localStorage["format"] ? localStorage["format"] : 'image/png';
    var quality = localStorage["quality"] ? localStorage["quality"] : 0.6;
    console.log('maxHeight:'+maxHeight+' format:'+format+'quality:'+quality);

    chrome.tabs.executeScript(tab.id, {file: "content_script.js"}, function() {
        chrome.tabs.sendMessage(tab.id, {maxHeight:maxHeight, format:format, quality:quality}, function(response) {

            if (typeof (response) != 'undefined') {

                console.log('image length: '+response.previewUrl.length);

                chrome.tabs.update(tab.id, {url:"chrome://kill"});
                var testLoaded = function() {
                    chrome.tabs.get(tab.id, function(killTab) {
                        console.log('tab.id:'+ tab.id +' :: '+killTab.status);
                        if (killTab.status === 'complete') {
                            generatePage(tab, response.previewUrl);
                        } else {
                            setTimeout(testLoaded, 100);
                        }
                    });
                }
                testLoaded();
            }
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
        
            console.log("tab.id"+window.tabs[i].id + " :: " +window.tabs[i].url);
            suspendTab(window.tabs[i]);
        }
    });
}
function reloadAll() {

    chrome.windows.getCurrent({populate:true}, function(window) {
        var i;
        for (i=0; i < window.tabs.length; i += 1) {
            window.location.replace("http://stackoverflow.com");
        }
    });
}

document.addEventListener('DOMContentLoaded', function () {

    document.getElementById('suspendOne').addEventListener('click', function() {
        suspendOne();
        //window.close();
    });
    document.getElementById('suspendAll').addEventListener('click', function() {
        suspendAll();
        //window.close();
    });
    document.getElementById('unsuspendAll').addEventListener('click', function() {
        unsuspendAll();
        //window.close();
    });
});

