/*global window, document, chrome, console, gsStorage */

(function() {

    'use strict';

    var tabs = {},
        windows = {};

    function reloadTabs(element, suspendMode) {

        return function() {

            var windowId = element.getAttribute('data-windowId'),
                sessionId = element.getAttribute('data-sessionId'),
                gsSessionHistory = gsStorage.fetchGsSessionHistory(),
                session = gsStorage.getSessionFromGroupKey(sessionId, gsSessionHistory),
                window = gsStorage.getWindowFromSession(windowId, session),
                curUrl,
                i;

            if (suspendMode) {
                for (i = 0; i < window.tabs.length; i++) {
                    curUrl = gsStorage.generateSuspendedUrl(window.tabs[i].url);
                    chrome.tabs.create({url: curUrl, pinned: window.tabs[i].pinned, active: false});
                }

            } else {
                for (i = 0; i < window.tabs.length; i++) {
                    chrome.tabs.create({url: window.tabs[i].url, pinned: window.tabs[i].pinned, active: false});
                }
            }
        };
    }

    function removeTab(element) {

        return function() {
            var tabId = element.getAttribute('data-tabId'),
                windowId = element.getAttribute('data-windowId'),
                sessionId = element.getAttribute('data-sessionId');
            gsStorage.removeTabFromSessionHistory(sessionId, windowId, tabId);

            render();
        };
    }

    function render() {

        var gsHistory = gsStorage.fetchGsSessionHistory(),
            i,
            j,
            k,
            linksList = document.getElementById('recoveryLinks'),
            windowProperties,
            tabProperties;

        linksList.innerHTML = '';

        for (i = 0; i < gsHistory.length; i++) {

            //ignore current session
            if (chrome.extension.getBackgroundPage().tgs.sessionId === gsHistory[i].id) {
                continue;
            }

            linksList.appendChild(createSessionHtml(gsHistory[i]));

            for (j = 0; j < gsHistory[i].windows.length; j++) {
                windowProperties = gsHistory[i].windows[j];
                windowProperties.sessionId = gsHistory[i].id;
                linksList.appendChild(createWindowHtml(windowProperties, j));

                for (k = 0; k < gsHistory[i].windows[j].tabs.length; k++) {
                    tabProperties = gsHistory[i].windows[j].tabs[k];
                    tabProperties.windowId = gsHistory[i].windows[j].id;
                    tabProperties.sessionId = gsHistory[i].id;
                    linksList.appendChild(createTabHtml(tabProperties));
                }
            }
        }
    }

    function createSessionHtml(session) {

        var sessionHeading;

        sessionHeading = document.createElement('h2');
        sessionHeading.innerHTML = gsStorage.getHumanDate(session.date);
        //sessionHeading.setAttribute('href', '#');

        return sessionHeading;
    }

    function createWindowHtml(window, count) {

        var groupHeading,
            groupUnsuspendCurrent,
            groupUnsuspendNew;

        groupHeading = document.createElement('p');
        groupHeading.setAttribute('data-windowId', window.id);
        groupHeading.setAttribute('data-sessionId', window.sessionId);
        //groupHeading.innerHTML = 'Window ' + (count + 1) + '<br />';// + ' (' + window.tabs.length + ' tab' + (window.tabs.length > 1 ? 's)' : ')') + '<br />';
        groupUnsuspendCurrent = document.createElement('a');
        groupUnsuspendCurrent.className = 'groupLink';
        groupUnsuspendCurrent.setAttribute('href', '#');
        groupUnsuspendCurrent.innerHTML = 'resuspend all tabs';
        groupUnsuspendCurrent.onclick = reloadTabs(groupHeading, true);
        groupHeading.appendChild(groupUnsuspendCurrent);
        groupUnsuspendNew = document.createElement('a');
        groupUnsuspendNew.className = 'groupLink';
        groupUnsuspendNew.setAttribute('href', '#');
        groupUnsuspendNew.innerHTML = 'reload all tabs';
        groupUnsuspendNew.onclick = reloadTabs(groupHeading, false);
        groupHeading.appendChild(groupUnsuspendNew);

        return groupHeading;
    }

    function createTabHtml(tabProperties) {

        var linksSpan = document.createElement('div'),
            listImg,
            listLink,
            listHover,
            favicon = false;

        favicon = favicon || tabProperties.favicon;
        favicon = favicon || tabProperties.favIconUrl;
        favicon = favicon || 'chrome://favicon/' + tabProperties.url;

        linksSpan.className = 'recoveryLink';
        linksSpan.setAttribute('data-tabId', tabProperties.id ? tabProperties.id : tabProperties.url);
        linksSpan.setAttribute('data-windowId', tabProperties.windowId);
        linksSpan.setAttribute('data-sessionId', tabProperties.sessionId);
        listHover = document.createElement('img');
        listHover.setAttribute('src', chrome.extension.getURL('x.gif'));
        listHover.className = 'itemHover';
        listHover.onclick = removeTab(linksSpan);
        linksSpan.appendChild(listHover);
        listImg = document.createElement('img');
        listImg.setAttribute('src', favicon);
        listImg.setAttribute('height', '16px');
        listImg.setAttribute('width', '16px');
        linksSpan.appendChild(listImg);
        listLink = document.createElement('a');
        listLink.setAttribute('class', 'historyLink');
        listLink.setAttribute('href', tabProperties.url);
        listLink.setAttribute('target', '_blank');
        listLink.innerHTML = tabProperties.title;
        linksSpan.appendChild(listLink);
        linksSpan.appendChild(document.createElement('br'));

        return linksSpan;
    }


    window.onload = function() {
        render();
    };

}());
