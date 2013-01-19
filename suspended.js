/*global window, document, chrome, localStorage, console */

(function () {

    "use strict";

    window.onload = function () {
        chrome.extension.sendMessage({ action: "initialise" }, function (response) {

            var gsHistory,
                url,
                historyDiv,
                historyLink,
                historyImg,
                historySpan,
                index,
                i;

            //if this page is being automatically reloaded then navigate to the original page instead
            if (response.backtrack === "true") {
                //if there is some history information then use it
                if (window.history.length > 9) {
                    window.history.back();

                //otherwise try to find a url to navigate to from the hash in url
                } else if (window.location.hash.length > 0) {
                    window.location = window.location.hash.substring(1);

                //finally, show gs history instead (as all else has failed)
                } else {

                    gsHistory = localStorage.getItem("gsHistory");
                    if (gsHistory !== null && gsHistory.length > 0) {
                        try {
                            gsHistory = JSON.parse(gsHistory);
                            document.getElementById("gsAnchor").style.display = 'none';
                            historyDiv = document.getElementById('gsHistory');
                            historyDiv.style.display = 'block';

                            for (i = 0; i < gsHistory.length; i++) {
                                historyImg = document.createElement("img");
                                gsHistory[i].icon = gsHistory[i].icon || chrome.extension.getURL("default.ico")
                                historyImg.setAttribute('src', gsHistory[i].icon);
                                historyImg.setAttribute('height', '16px');
                                historyImg.setAttribute('width', '16px');
                                historyDiv.appendChild(historyImg);
                                historyLink = document.createElement('a');
                                historyLink.setAttribute('href', gsHistory[i].url);
                                historyLink.innerHTML = gsHistory[i].title;
                                historyDiv.appendChild(historyLink);
                                historySpan = document.createElement("span");
                                historySpan.innerHTML = gsHistory[i].date;
                                historyDiv.appendChild(historySpan);
                                historyDiv.appendChild(document.createElement("br"));
                            }
                        } catch (e) {
                            console.log("some kind of error just happened");
                        }
                    }

                }

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
                window.location.hash = response.url;
            }
        });
    };
}());