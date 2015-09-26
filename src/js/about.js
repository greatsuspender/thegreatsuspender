/*global chrome */

(function () {

    'use strict';
    var gsUtils = chrome.extension.getBackgroundPage().gsUtils;

    var readyStateCheckInterval = window.setInterval(function () {
        if (document.readyState === 'complete') {

            window.clearInterval(readyStateCheckInterval);

            var versionEl = document.getElementById('aboutVersion');
            versionEl.innerHTML = 'The Great Suspender v' + chrome.runtime.getManifest().version;

            if (gsUtils.getOption(gsUtils.NO_NAG)) {
                document.getElementById('donateSection').style.display = 'none';
                document.getElementById('donatedSection').style.display = 'block';
            }

            function toggleNag(hideNag) {
                gsUtils.setOption(gsUtils.NO_NAG, hideNag);
            }

            function loadDonateButtons() {
                document.getElementById("donateButtons").innerHTML = this.responseText;

                var donateBtns = document.getElementsByClassName('btnDonate'),
                    i;

                for (i = 0; i < donateBtns.length; i++) {
                  donateBtns[i].onclick = function() {
                    toggleNag(true);
                  };
                }
                document.getElementById('alreadyDonatedToggle').onclick = function() {
                    toggleNag(true);
                    window.location.reload();
                };
                document.getElementById('donateAgainToggle').onclick = function() {
                    toggleNag(false);
                    window.location.reload();
                };
            }

            var request = new XMLHttpRequest();
            request.onload = loadDonateButtons;
            request.open("GET", "support.html", true);
            request.send();
        }
    }, 50);

}());
