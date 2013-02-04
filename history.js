/*global window, document, chrome, console, localStorage */

(function () {

    "use strict";

    function getGsHistory() {

        var result = localStorage.getItem('gsHistory2');
        if (result === null) {
            result = [];
        } else {
            result = JSON.parse(result);
        }
        return result;
    }

    function getFormattedDate(date, includeTime) {
        var d = new Date(date),
            cur_date = ("0" + d.getDate()).slice(-2),
            cur_month = ("0" + (d.getMonth() + 1)).slice(-2),
            cur_year = d.getFullYear(),
            cur_time = d.toTimeString().match(/^([0-9]{2}:[0-9]{2})/)[0];

        if (includeTime) {
            return cur_time + " " + cur_date + "-" + cur_month + "-" + cur_year;
        } else {
            return cur_date + "-" + cur_month + "-" + cur_year;
        }
    }

    function reloadTabs(date) {
        var curDate = date;
        return function () {
            var gsHistory = getGsHistory(),
                historyMap = {},
                groupKey,
                tabProperties,
                i;

            for (i = 0; i < gsHistory.length; i++) {
                tabProperties = gsHistory[i];
                groupKey = getFormattedDate(tabProperties.date, false);

                if (curDate === groupKey) {
                    if (!historyMap.hasOwnProperty(tabProperties.url)) {
                        historyMap[tabProperties.url] = true;
                        chrome.tabs.create({url: chrome.extension.getURL("suspended.html"
                                                + "#id=" + tabProperties.id
                                                + "&url=" + tabProperties.url)});
                    }
                }
            }
        };
    }

    window.onload = function () {

        var gsHistory = getGsHistory(),
            historyMap = {},
            key,
            groupKey,
            curGroupKey,
            tabProperties,
            historyDiv,
            historyImg,
            historyLink,
            historySpan,
            groupHeading,
            groupLink,
            i;

        try {
            historyDiv = document.getElementById('gsHistory');

            for (i = 0; i < gsHistory.length; i++) {
                tabProperties = gsHistory[i];
                groupKey = getFormattedDate(tabProperties.date, false);
                key = groupKey + tabProperties.url;

                if (groupKey !== curGroupKey) {
                    curGroupKey = groupKey;
                    groupHeading = document.createElement("h2");
                    groupHeading.innerHTML = groupKey;
                    groupLink = document.createElement("a");
                    groupLink.className = "groupLink";
                    groupLink.innerHTML = "reload all suspended tabs for this day";
                    groupLink.setAttribute('href', "#");
                    groupLink.onclick = reloadTabs(groupKey);//reloadTabs(gsHistory, groupKey));
                    groupHeading.appendChild(groupLink);
                    historyDiv.appendChild(groupHeading);
                }
                if (!historyMap.hasOwnProperty(key)) {
                    historyMap[key] = true;
                    historyImg = document.createElement("img");
                    historyImg.setAttribute('src', 'chrome://favicon/' + tabProperties.url);
                    historyImg.setAttribute('height', '16px');
                    historyImg.setAttribute('width', '16px');
                    historyDiv.appendChild(historyImg);
                    historyLink = document.createElement('a');
                    historyLink.setAttribute('href', tabProperties.url);
                    historyLink.setAttribute('target', '_blank');
                    historyLink.innerHTML = tabProperties.title;
                    historyDiv.appendChild(historyLink);
                    historySpan = document.createElement("span");
                    historySpan.innerHTML = getFormattedDate(tabProperties.date, true);
                    historyDiv.appendChild(historySpan);
                    historyDiv.appendChild(document.createElement("br"));
                }
            }
        } catch (e) {
            console.log("some kind of error just happened");
        }

    };

}());