
// Saves options to localStorage.
function save_options() {
  var select = document.getElementById("format");
  var format = select.children[select.selectedIndex].value;
  localStorage["format"] = format;
  
  select = document.getElementById("quality");
  var quality = select.children[select.selectedIndex].value;
  localStorage["quality"] = quality;
  
  select = document.getElementById("maxHeight");
  var maxHeight = select.value;
  localStorage["maxHeight"] = maxHeight;
  
  window.close();
}

// Restores select box state to saved value from localStorage.
function restore_options() {

  selectComboBox(document.getElementById("format"), localStorage["format"]);
  selectComboBox(document.getElementById("quality"), localStorage["quality"]);
  document.getElementById("maxHeight").value = localStorage["maxHeight"];
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


var readyStateCheckInterval = setInterval(function() {
    if (document.readyState === "complete") {

        clearInterval(readyStateCheckInterval);

        document.getElementById('save').onclick = function (e) {
          save_options();
        }

        restore_options();
    }
}, 10);