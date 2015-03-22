/*global chrome */

(function () {

    'use strict';
    var gsUtils = chrome.extension.getBackgroundPage().gsUtils;

    var readyStateCheckInterval = window.setInterval(function () {
        if (document.readyState === 'complete') {

            window.clearInterval(readyStateCheckInterval);

            var versionEl = document.getElementById('aboutVersion'),
                donateBtns = document.getElementsByClassName('btnDonate'),
                i;

            versionEl.innerHTML = 'The Great Suspender v' + chrome.runtime.getManifest().version;

            function hideNagForever() {
                gsUtils.setOption(gsUtils.NO_NAG, true);
            }

            for (i = 0; i < donateBtns.length; i++) {
              donateBtns[i].onclick = hideNagForever;
            }

            if (gsUtils.getOption(gsUtils.NO_NAG)) {
                document.getElementById('donateSection').style.display = 'none';
                document.getElementById('donatedSection').style.display = 'block';
            }
        }
    }, 50);

}());
