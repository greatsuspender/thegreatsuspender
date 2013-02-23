/*global window, document, chrome, console, gsStorage */

(function () {

    "use strict";

    var gsWindowsToRecover = {};

    function compareTabs(a, b) {

        a.windowId = a.windowId || 0;
        b.windowId = b.windowId || 0;
        a.index = a.index || 0;
        b.index = b.index || 0;

        if (a.windowId > b.windowId) {
            return -1;
        }
        if (a.windowId < b.windowId) {
            return 1;
        }
        if (a.windowId === b.windowId) {
            if (a.index < b.index) {
                return -1;
            }
            if (a.index > b.index) {
                return 1;
            }
        }
        return 0;
    }

    function fetchSuspendedGsHistoryForWindow(windowId) {

        var gsHistory = gsStorage.fetchGsHistory(),
            historyMap = {},
            historyArray = [],
            tabProperties,
            i;

        for (i = 0; i < gsHistory.length; i++) {
            tabProperties = gsHistory[i];

            if (tabProperties.state !== 'unsuspended'
                    && tabProperties.windowId === windowId
                    && !historyMap.hasOwnProperty(tabProperties.url)) {
                historyMap[tabProperties.url] = true;
                historyArray.push(tabProperties);
            }
        }
        return historyArray;
    }

    function fetchSuspendedGsHistory() {

        var gsHistory = gsStorage.fetchGsHistory(),
            historyMap = {},
            historyArray = [],
            tabProperties,
            i;

        for (i = 0; i < gsHistory.length; i++) {
            tabProperties = gsHistory[i];

            if (tabProperties.state !== 'unsuspended'
                    && !historyMap.hasOwnProperty(tabProperties.url)) {
                historyMap[tabProperties.url] = true;
                historyArray.push(tabProperties);
            }
        }
        return historyArray;
    }

    function reloadTabs(windowId, newWindow) {

        return function () {

            var tabsToReload = gsWindowsToRecover[windowId],
                urlList = [],
                i;

            if (newWindow) {
                for (i = 0; i < tabsToReload.length; i++) {
                    urlList.push(gsStorage.generateSuspendedUrl(tabsToReload[i].url));
                }
                chrome.windows.create({url: urlList});

            } else {
                for (i = 0; i < tabsToReload.length; i++) {
                    chrome.tabs.create({url: gsStorage.generateSuspendedUrl(tabsToReload[i].url)});
                }
            }
        };
    }

    function removeTab(element, windowId, tabProperties) {

        return function () {
            var i;
            for (i in gsWindowsToRecover[windowId]) {
                if (gsWindowsToRecover[windowId].hasOwnProperty(i) && gsWindowsToRecover[windowId][i].url === tabProperties.url) {
                    gsWindowsToRecover[windowId].splice(i, 1);
                    break;
                }
            }
            element.remove();
        };
    }

    function createGroupHtml(windowIndex) {

        var groupHeading,
            groupUnsuspendCurrent,
            groupUnsuspendNew;

        groupHeading = document.createElement("h2");
        groupHeading.innerHTML = 'Window ' + windowIndex + ":";
        groupUnsuspendCurrent = document.createElement("a");
        groupUnsuspendCurrent.className = "groupLink";
        groupUnsuspendCurrent.innerHTML = "re-suspend in current window";
        groupUnsuspendCurrent.setAttribute('href', "#");
        groupUnsuspendCurrent.onclick = reloadTabs(windowIndex, false);
        groupHeading.appendChild(groupUnsuspendCurrent);
        groupUnsuspendNew = document.createElement("a");
        groupUnsuspendNew.className = "groupLink";
        groupUnsuspendNew.setAttribute('href', "#");
        groupUnsuspendNew.innerHTML = "re-suspend in new window";
        groupUnsuspendNew.onclick = reloadTabs(windowIndex, true);
        groupHeading.appendChild(groupUnsuspendNew);

        return groupHeading;
    }

    function createTabHtml(windowIndex, tabProperties) {

        var linksSpan = document.createElement('span'),
            listImg,
            listLink,
            listHover;

        linksSpan.className = "recoveryLink";
        listHover = document.createElement('img');
        listHover.setAttribute('src', chrome.extension.getURL("x.gif"));
        listHover.className = "itemHover";
        listHover.onclick = removeTab(linksSpan, windowIndex, tabProperties);
        linksSpan.appendChild(listHover);
        listImg = document.createElement("img");
        listImg.setAttribute('src', 'chrome://favicon/' + tabProperties.url);
        listImg.setAttribute('height', '16px');
        listImg.setAttribute('width', '16px');
        linksSpan.appendChild(listImg);
        listLink = document.createElement('a');
        listLink.setAttribute('href', tabProperties.url);
        listLink.setAttribute('target', '_blank');
        listLink.innerHTML = tabProperties.title;
        linksSpan.appendChild(listLink);
        linksSpan.appendChild(document.createElement("br"));

        return linksSpan;
    }

    window.onload = function () {

        if (document.getElementById('clearLink') !== null) {
            document.getElementById('clearLink').addEventListener("click", function (event) {

                var gsHistory = fetchSuspendedGsHistory(),
                    i;

                for (i in gsHistory) {
                    if (gsHistory.hasOwnProperty(i)) {
                        gsHistory[i].state = 'unsuspended';
                        gsStorage.saveTabToHistory(gsHistory[i].url, gsHistory[i]);
                    }
                }
                chrome.tabs.getCurrent(function (tab) {
                    chrome.tabs.remove(tab.id);
                    chrome.tabs.create({url: chrome.extension.getURL("recovery.html")});
                });

            });
        }
        if (document.getElementById('historyLink') !== null) {
            document.getElementById('historyLink').addEventListener("click", function (event) {
                chrome.tabs.create({url: chrome.extension.getURL("history.html")});
            });
        }



        var gsHistory = fetchSuspendedGsHistory(),
            curGroupKey = -1,
            key,
            i,
            j = 1,
            linksList = document.getElementById('recoveryLinks'),
            curUrl;

        gsWindowsToRecover = {};
        gsHistory.sort(compareTabs);

        for (i in gsHistory) {
            if (gsHistory.hasOwnProperty(i)) {

                key = gsHistory[i].windowId + '_' + gsHistory[i].url;

                //print header for group
                if (gsHistory[i].windowId !== curGroupKey) {
                    gsWindowsToRecover[j] = [];
                    curGroupKey = gsHistory[i].windowId;
                    linksList.appendChild(createGroupHtml(j));
                    j++;
                }

                //print tab entry
                linksList.appendChild(createTabHtml(j - 1, gsHistory[i]));

                gsWindowsToRecover[j - 1].push(gsHistory[i]);
            }
        }

    };

}());