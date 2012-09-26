
// Saves options to localStorage.
function save_options() {

    
    var preview = document.getElementById("preview");
    localStorage["greatsuspender.preview"] = preview.checked;
    
    var select = document.getElementById("format");
    var format = select.children[select.selectedIndex].value;
    localStorage["greatsuspender.format"] = format;
    
    select = document.getElementById("quality");
    var quality = select.children[select.selectedIndex].value;
    localStorage["greatsuspender.quality"] = quality;
    
    select = document.getElementById("maxHeight");
    var maxHeight = select.children[select.selectedIndex].value;
    localStorage["greatsuspender.maxHeight"] = maxHeight;
    
    window.close();
}

// Restores select box state to saved value from localStorage.
function restore_options() {

    var preview = typeof (localStorage["greatsuspender.preview"]) != 'undefined' ? 
    						localStorage["greatsuspender.preview"] == "true" : true; 
    var format = typeof (localStorage["greatsuspender.format"]) != 'undefined' ? 
    						localStorage["greatsuspender.format"] : "image/png"; 
    var quality = typeof (localStorage["greatsuspender.quality"]) != 'undefined' ? 
    						localStorage["greatsuspender.quality"] : 0.4; 
    var maxHeight = typeof (localStorage["greatsuspender.maxHeight"]) != 'undefined' ? 
    						localStorage["greatsuspender.maxHeight"] : 2; 

    document.getElementById("preview").checked = preview;
    selectComboBox(document.getElementById("format"), format);
    selectComboBox(document.getElementById("quality"), quality);
    selectComboBox(document.getElementById("maxHeight"), maxHeight);

    enablePreviewComponents(preview);
    enableQualityComponent(preview && format === "image/jpeg");
}

function selectComboBox(element, key) {
    for (var i = 0; i < element.children.length; i++) {
        var child = element.children[i];
        if (child.value == key) {
            child.selected = "true";
            break;
        }
    }
}

function enablePreviewComponents(visible) {

    if (visible) {
        document.getElementById('format').removeAttribute("class", "hidden");
        document.getElementById('maxHeight').removeAttribute("class", "hidden");
        document.getElementById('formatLbl').removeAttribute("class", "hidden");
        document.getElementById('maxHeightLbl').removeAttribute("class", "hidden");
    } else {
        document.getElementById('format').setAttribute("class", "hidden");
        document.getElementById('maxHeight').setAttribute("class", "hidden");
        document.getElementById('formatLbl').setAttribute("class", "hidden");
        document.getElementById('maxHeightLbl').setAttribute("class", "hidden");
    }
}

function enableQualityComponent(visible) {
    
    if (visible) {
        document.getElementById('quality').removeAttribute("class", "hidden");
        document.getElementById('qualityLbl').removeAttribute("class", "hidden");
    } else {
        document.getElementById('quality').setAttribute("class", "hidden");
        document.getElementById('qualityLbl').setAttribute("class", "hidden");
    }
}


var readyStateCheckInterval = setInterval(function() {
    if (document.readyState === "complete") {

        clearInterval(readyStateCheckInterval);

        var previewEl = document.getElementById('preview'),
            formatEl = document.getElementById('format'),
            saveEl = document.getElementById('save');

        previewEl.onclick = function (e) {
            enablePreviewComponents(this.checked);
            enableQualityComponent(this.checked && formatEl.children[formatEl.selectedIndex].value === "image/jpeg");
        }
        formatEl.onclick = function (e) {
            enableQualityComponent(this.children[this.selectedIndex].value === "image/jpeg");
        }
        saveEl.onclick = function (e) {
            save_options();
        }

        restore_options();
    }
}, 10);