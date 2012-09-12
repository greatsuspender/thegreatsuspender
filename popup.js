
function generatePage(tab, previewUrl) {
  
  var html = '<title>' + tab.title + '</title>';
  html += '<link rel="icon" href="' + tab.favIconUrl + '" />'
    if (previewUrl) {
        html += '<a href="' + tab.url + '"><img src="' + previewUrl + '" /></a>'
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
                    'box-shadow: 0 4px 5px -2px #555;">Tab suspended - click to reload.</div>' + 
                    'border-bottom: 1px solid #6B5811;';
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

function handleTab(tab) {
    chrome.tabs.executeScript(tab.id, {file: "content_script.js"}, function() {
        chrome.tabs.sendMessage(tab.id, {}, function(response) {
            if (typeof (response.previewUrl) != 'undefined') {
                generatePage(tab, response.previewUrl);
                console.log('image length: '+response.previewUrl.length);
            } else {
                generatePage(tab, false);
            }
        });
    });    
}

function suspendAll() {

    chrome.tabs.query({}, function(tabs) {
        var i;
        for (i=0; i < tabs.length; i += 1) {
          if (!tabs[i].active && tabs[i].url.indexOf('data') < 0) {
                handleTab(tabs[i]);
            }
        }
    });
}

document.addEventListener('DOMContentLoaded', function () {

    document.getElementById('suspendOne').addEventListener('click', function() {
        suspendAll();
        //window.close();
    });
    document.getElementById('suspendAll').addEventListener('click', function() {
        suspendAll();
        //window.close();
    });
    document.getElementById('unsuspendAll').addEventListener('click', function() {
        suspendAll();
        //window.close();
    });
});

