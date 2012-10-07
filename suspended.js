/*global window, document, chrome */

(function () {

    "use strict";

    window.onload = function () {
        chrome.extension.sendMessage({ action: "initialise" }, function (response) {

            //if this page is being automatically reloaded then navigate to the original page instead
            if (response.backtrack === "true") {
                window.history.back();

            //otherwise set up suspended page to mimic tab being suspended
            } else {

                document.onclick = function () {
                    window.history.back();
                };

                document.getElementById("gsTitle").innerText = response.title;
                document.getElementById("gsFavicon").setAttribute('href', response.favicon);
                document.getElementById("gsAnchor").setAttribute('href', response.url);
                if (typeof response.preview !== 'undefined') {
                    document.getElementById("gsPreview").setAttribute('src', response.preview);
                }
            }
        });
    };
}());