/*global chrome */
var sessionItems = (function () { // eslint-disable-line no-unused-vars
    'use strict';

    var tgs = chrome.extension.getBackgroundPage().tgs;
    var gsUtils = chrome.extension.getBackgroundPage().gsUtils;

    function getSimpleDate(date) {
        var d = new Date(date);
        return ('0' + d.getDate()).slice(-2) + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
            d.getFullYear() + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    }

    function getHumanDate(date) {
        var monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
            d = new Date(date),
            currentDate = d.getDate(),
            currentMonth = d.getMonth(),
            currentYear = d.getFullYear(),
            currentHours = d.getHours(),
            currentMinutes = d.getMinutes();

        // var suffix;
        // if (currentDate === 1 || currentDate === 21 || currentDate === 31) {
        //     suffix = 'st';
        // } else if (currentDate === 2 || currentDate === 22) {
        //     suffix = 'nd';
        // } else if (currentDate === 3 || currentDate === 23) {
        //     suffix = 'rd';
        // } else {
        //     suffix = 'th';
        // }

        var ampm = currentHours >= 12 ? 'pm' : 'am';
        var hoursString = (currentHours % 12) || 12;
        var minutesString = ('0' + currentMinutes).slice(-2);

        return currentDate + ' ' + monthNames[currentMonth] + ' ' + currentYear + ' ' + hoursString + ':' + minutesString + ampm;
    }

    function createSessionHtml(session) {
        session.windows = session.windows || [];

        var sessionType = (session.sessionId === tgs.sessionId) ? 'current' : (session.name ? 'saved' : 'recent'),
            sessionContainer,
            sessionTitle,
            sessionSave,
            sessionDelete,
            sessionExport,
            sessionDiv,
            windowResuspend,
            windowReload,
            titleText,
            winCnt = session.windows.length,
            tabCnt = session.windows.reduce(function (a, b) { return a + b.tabs.length; }, 0);

        if (sessionType === 'saved') {
            titleText = session.name;
        } else {
            titleText = getHumanDate(session.date);
        }
        titleText += '&nbsp;&nbsp;<small>(' +
            winCnt + pluralise(' ' + chrome.i18n.getMessage('js_sessionItems_window'), winCnt) + ', ' +
            tabCnt + pluralise(' ' + chrome.i18n.getMessage('js_sessionItems_tab'), tabCnt) + ')</small>';

        sessionDiv = createEl('div', {
            'class': 'sessionContents',
        });

        sessionTitle = createEl('span', {
            'class': 'sessionLink'
        });
        sessionTitle.innerHTML = titleText;

        sessionSave = createEl('a', {
            'class': 'groupLink saveLink',
            'href': '#'
        }, chrome.i18n.getMessage('js_sessionItems_save'));

        sessionDelete = createEl('a', {
            'class': 'groupLink deleteLink',
            'href': '#'
        }, chrome.i18n.getMessage('js_sessionItems_delete'));

        windowResuspend = createEl('a', {
            'class': 'groupLink resuspendLink',
            'href': '#'
        }, chrome.i18n.getMessage('js_sessionItems_resuspend'));

        windowReload = createEl('a', {
            'class': 'groupLink reloadLink',
            'href': '#'
        }, chrome.i18n.getMessage('js_sessionItems_reload'));

        sessionExport = createEl('a', {
            'class': 'groupLink exportLink',
            'href': '#'
        }, chrome.i18n.getMessage('js_sessionItems_export'));

        sessionContainer = createEl('div', {
            'class': 'sessionContainer',
        });
        sessionContainer.appendChild(sessionTitle);
        if (sessionType !== 'current') {
            sessionContainer.appendChild(windowResuspend);
            sessionContainer.appendChild(windowReload);
        }
        sessionContainer.appendChild(sessionExport);
        if (sessionType !== 'saved') {
            sessionContainer.appendChild(sessionSave);
        }
        if (sessionType !== 'current') {
            sessionContainer.appendChild(sessionDelete);
        }
        sessionContainer.appendChild(sessionDiv);

        return sessionContainer;
    }

    function createWindowHtml(window, index, allowReload) {

        var groupHeading,
            windowContainer,
            groupUnsuspendCurrent,
            groupUnsuspendNew;

        groupHeading = createEl('div', {
            'class': 'windowContainer',
        });

        windowContainer = createEl('span', {}, 'Window ' + (index + 1) + ':\u00A0');

        groupUnsuspendCurrent = createEl('a', {
            'class': 'groupLink resuspendLink ',
            'href': '#'
        }, chrome.i18n.getMessage('js_sessionItems_resuspend'));

        groupUnsuspendNew = createEl('a', {
            'class': 'groupLink reloadLink',
            'href': '#'
        }, chrome.i18n.getMessage('js_sessionItems_reload'));

        groupHeading.appendChild(windowContainer);
        if (allowReload) {
            groupHeading.appendChild(groupUnsuspendCurrent);
            groupHeading.appendChild(groupUnsuspendNew);
        }

        return groupHeading;
    }

    function createTabHtml(tab, allowDelete) {

        var linksSpan,
            listImg,
            listLink,
            listHover,
            favicon = false;

        //try to get best favicon url path
        if (tab.favicon) {
            favicon = tab.favicon;
        } else if (tab.favIconUrl && tab.favIconUrl.indexOf('chrome://theme') < 0) {
            favicon = tab.favIconUrl;
        }
        if (!favicon || favicon === chrome.extension.getURL('img/icon16.png')) {
            favicon = 'chrome://favicon/size/16@2x/';
            if (tgs.isSuspended(tab)) {
                favicon += gsUtils.getSuspendedUrl(tab.url);
            } else {
                favicon += tab.url;
            }
        }

        if (tab.sessionId) {
            linksSpan = createEl('div', {
                'class': 'tabContainer',
                'data-tabId': tab.id || tab.url,
                'data-url': tab.url
            });
        } else {
            linksSpan = createEl('div', {
                'class': 'tabContainer',
                'data-url': tab.url
            });
        }

        listHover = createEl('img', {
            'src': chrome.extension.getURL('/img/x.gif'),
            'class': 'itemHover removeLink'
        });

        listImg = createEl('img', {
            'src': favicon,
            'height': '16px',
            'width': '16px'
        });

        listLink = createEl('a', {
            'class': 'historyLink',
            'href': tab.url,
            'target': '_blank'
        }, tab.title);

        if (allowDelete) {
            linksSpan.appendChild(listHover);
        }
        linksSpan.appendChild(listImg);
        linksSpan.appendChild(listLink);
        linksSpan.appendChild(createEl('br'));

        return linksSpan;
    }

    function createEl(elType, attributes, text) {

        var el = document.createElement(elType);
        attributes = attributes || {};
        el = setElAttributes(el, attributes);
        el.innerHTML = gsUtils.htmlEncode(text || '');
        return el;
    }
    function setElAttributes(el, attributes) {
        for (var key in attributes) {
            if (attributes.hasOwnProperty(key)) {
                el.setAttribute(key, attributes[key]);
            }
        }
        return el;
    }

    function pluralise(text, count) {
        return text + (count > 1 ? chrome.i18n.getMessage('js_sessionItems_plural') : '');
    }

    return {
        createSessionHtml: createSessionHtml,
        createWindowHtml: createWindowHtml,
        createTabHtml: createTabHtml
    };
}());
