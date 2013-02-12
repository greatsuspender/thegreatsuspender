/*global window, document, chrome, console, gsStorage */

(function () {

    "use strict";

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

    function reloadTabs(date, suspend) {
        var curDate = date;
        return function () {

            var gsHistory = gsStorage.fetchGsHistory(),
                historyMap = {},
                groupKey,
                tabProperties,
                i,
                url,
                index;

            chrome.tabs.query({}, function (tabs) {

                for (i = 0; i < gsHistory.length; i++) {
                    tabProperties = gsHistory[i];
                    groupKey = getFormattedDate(tabProperties.date, false);

                    if (curDate === groupKey) {
                        if (!historyMap.hasOwnProperty(tabProperties.url)) {
                            historyMap[tabProperties.url] = true;
                            url = suspend ? gsStorage.generateSuspendedUrl(tabProperties.url) : tabProperties.url;
                            chrome.tabs.create({url: url});
                        }
                    }
                }
            });
        };
    }

    function compare(a, b) {
        if (a.date > b.date) {
            return -1;
        }
        if (a.date < b.date) {
            return 1;
        }
        return 0;
    }

    window.onload = function () {

        var gsHistory = gsStorage.fetchGsHistory(),
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
            groupLinkSuspend,
            groupLinkUnsuspend,
            i;

        try {
            historyDiv = document.getElementById('gsHistory');
            gsHistory.sort(compare);

            for (i = 0; i < gsHistory.length; i++) {
                tabProperties = gsHistory[i];
                groupKey = getFormattedDate(tabProperties.date, false);
                key = groupKey + tabProperties.url;

                if (groupKey !== curGroupKey) {
                    curGroupKey = groupKey;
                    groupHeading = document.createElement("h2");
                    groupHeading.innerHTML = groupKey;
                    groupLinkSuspend = document.createElement("a");
                    groupLinkSuspend.className = "groupLink";
                    groupLinkSuspend.innerHTML = "re-suspend all tabs for this day";
                    groupLinkSuspend.setAttribute('href', "#");
                    groupLinkSuspend.onclick = reloadTabs(groupKey, true);
                    groupHeading.appendChild(groupLinkSuspend);
                    groupLinkUnsuspend = document.createElement("a");
                    groupLinkUnsuspend.className = "groupLink";
                    groupLinkUnsuspend.innerHTML = "reload all tabs for this day";
                    groupLinkUnsuspend.setAttribute('href', "#");
                    groupLinkUnsuspend.onclick = reloadTabs(groupKey, false);
                    groupHeading.appendChild(groupLinkUnsuspend);
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