/*global chrome, gsUtils, createWindowHtml, createTabHtml */

var sessionUtils = (function () {

    'use strict';
    var tgs = chrome.extension.getBackgroundPage().tgs,
        gsUtils = chrome.extension.getBackgroundPage().gsUtils;


    function hideModal() {
        document.getElementById('sessionNameModal').style.display = 'none';
        document.getElementsByClassName('mainContent')[0].className = 'mainContent';
    }

    function reloadTabs(element, suspendMode) {

        return function () {
            var windowId = element.getAttribute('data-windowId'),
                sessionId = element.getAttribute('data-sessionId'),
                windows = [],
                curUrl;

            gsUtils.fetchSessionById(sessionId).then(function (session) {

                //if loading a specific window
                if (windowId) {
                    windows.push(gsUtils.getWindowFromSession(windowId, session));

                //else load all windows from session
                } else {
                    windows = session.windows;
                }

                windows.forEach(function(window) {

                    chrome.windows.create(function (newWindow) {
                        window.tabs.forEach(function (curTab) {
                            curUrl = curTab.url;

                            if (suspendMode && curUrl.indexOf('suspended.html') < 0 && !chrome.extension.getBackgroundPage().tgs.isSpecialTab(curTab)) {
                                curUrl = gsUtils.generateSuspendedUrl(curTab);
                            } else if (!suspendMode && curUrl.indexOf('suspended.html') > 0) {
                                curUrl = gsUtils.getSuspendedUrl(curTab.url);
                            }
                            chrome.tabs.create({windowId: newWindow.id, url: curUrl, pinned: curTab.pinned, active: false});
                        });

                        chrome.tabs.query({windowId: newWindow.id, index: 0}, function (tabs) {
                            chrome.tabs.remove(tabs[0].id);
                        });
                    });
                });

            });
        };
    }

    function saveSession(sessionId) {

        gsUtils.fetchSessionById(sessionId).then(function (session) {

            document.getElementsByClassName('mainContent')[0].className += ' blocked';
            document.getElementById('sessionNameModal').style.display = 'block';
            document.getElementById('sessionNameText').focus();

            document.getElementById('sessionNameCancel').onclick = hideModal;
            document.getElementById('sessionNameSubmit').onclick = function () {
                var text = document.getElementById('sessionNameText').value;
                if (text) {
                    session.name = text;
                    gsUtils.addToSavedSessions(session);
                    window.location.reload();
                }
            };
        });
    }

    function deleteSession(sessionId) {

        gsUtils.removeSessionFromHistory(sessionId, function() {
            window.location.reload();
        });
    }

    function exportSession(sessionId) {
        var csvContent = "data:text/csv;charset=utf-8,",
            dataString = '';

        gsUtils.fetchSessionById(sessionId).then(function (session) {

            session.windows.forEach(function (curWindow, index) {
                curWindow.tabs.forEach(function (curTab, tabIndex) {
                    if (curTab.url.indexOf("suspended.html") > 0) {
                        dataString += gsUtils.getSuspendedUrl(curTab.url) + '\n';
                    } else {
                        dataString += curTab.url + '\n';
                    }
                });
            });
            csvContent += dataString;

            var encodedUri = encodeURI(csvContent);
            var link = document.createElement("a");
            link.setAttribute("href", encodedUri);
            link.setAttribute("download", "session.txt");
            link.click();
        });
    }

    function removeTab(element) {

        return function () {

            var tabId = element.getAttribute('data-tabId'),
                windowId = element.getAttribute('data-windowId'),
                sessionId = element.getAttribute('data-sessionId'),
                sessionEl,
                newSessionEl;

            gsUtils.removeTabFromSessionHistory(sessionId, windowId, tabId, function(session) {
                //if we have a valid session returned
                if (session) {
                    sessionEl = element.parentElement.parentElement;
                    newSessionEl = createSessionHtml(session);
                    sessionEl.parentElement.replaceChild(newSessionEl, sessionEl);
                    toggleSession(newSessionEl.getElementsByTagName('div')[0])();

                //otherwise assume it was the last tab in session and session has been removed
                } else {
                    window.location.reload();
                }
            });
        };
    }

    function toggleSession(element) {

        return function () {

            var sessionId = element.getAttribute('data-sessionId'),
                windowProperties,
                tabProperties;

            if (element.childElementCount > 0) {
                element.innerHTML = '';
                return;
            }

            gsUtils.fetchSessionById(sessionId).then(function (session) {

                if (!session) {
                    return;
                }

                session.windows.forEach(function (window, index) {
                    windowProperties = window;
                    windowProperties.sessionId = session.sessionId;
                    element.appendChild(createWindowHtml(windowProperties, index));

                    windowProperties.tabs.forEach(function (tab) {
                        tabProperties = tab;
                        tabProperties.windowId = windowProperties.id;
                        tabProperties.sessionId = session.sessionId;
                        element.appendChild(createTabHtml(tabProperties));
                    });
                });
            });
        };
    }


    function createSessionHtml(session) {
        var savedSession = session.name ? true : false,
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
            tabCnt = session.windows.reduce(function(a, b) {return a + b.tabs.length;}, 0);

        if (savedSession) {
            titleText = session.name + ' (' + winCnt + pluralise(' window', winCnt) + ', ' + tabCnt + pluralise(' tab', tabCnt) + ')';
        } else {
            titleText = winCnt + pluralise(' window', winCnt) + ', ' + tabCnt + pluralise(' tab', tabCnt) + ': ' + gsUtils.getHumanDate(session.date);
        }

        sessionDiv = createEl('div', {
            'class': 'sessionDiv',
            'data-sessionId': session.sessionId
        });

        sessionTitle = createEl('span', {
            'class': 'sessionLink'
        }, titleText);
        sessionTitle.onclick = toggleSession(sessionDiv);

        if (!savedSession) {
            sessionSave = createEl('a', {
                'class': 'groupLink',
                'href': '#'
            }, 'save');
            sessionSave.onclick = function () {
                saveSession(session.sessionId);
            };
        }

        if (savedSession) {
            sessionDelete = createEl('a', {
                'class': 'groupLink',
                'href': '#'
            }, 'delete');
            sessionDelete.onclick = function () {
                deleteSession(session.sessionId);
            };
        }

        sessionExport = createEl('a', {
            'class': 'groupLink',
            'href': '#'
        }, 'export');
        sessionExport.onclick = function () {
            exportSession(session.sessionId);
        };

        windowResuspend = createEl('a', {
            'class': 'groupLink',
            'href': '#'
        }, 'resuspend');
        windowResuspend.onclick = reloadTabs(sessionDiv, true);

        windowReload = createEl('a', {
            'class': 'groupLink',
            'href': '#'
        }, 'reload');
        windowReload.onclick = reloadTabs(sessionDiv, false);

        sessionContainer = createEl('div');
        sessionContainer.appendChild(sessionTitle);
        sessionContainer.appendChild(windowResuspend);
        sessionContainer.appendChild(windowReload);
        sessionContainer.appendChild(sessionExport);
        if (!savedSession) sessionContainer.appendChild(sessionSave);
        if (savedSession) sessionContainer.appendChild(sessionDelete);
        sessionContainer.appendChild(sessionDiv);

        return sessionContainer;
    }

    function createWindowHtml(window, count) {

        var groupHeading,
            windowHeading,
            groupUnsuspendCurrent,
            groupUnsuspendNew;

        groupHeading = createEl('div', {
            'class': 'windowHeading',
            'data-windowId': window.id,
            'data-sessionId': window.sessionId
        });

        windowHeading = createEl('span', {}, 'Window ' + (count + 1) + ':\u00A0');

        groupUnsuspendCurrent = createEl('a', {
            'class': 'groupLink',
            'href': '#'
        }, 'resuspend');
        groupUnsuspendCurrent.onclick = reloadTabs(groupHeading, true);

        groupUnsuspendNew = createEl('a', {
            'class': 'groupLink',
            'href': '#'
        }, 'reload');
        groupUnsuspendNew.onclick = reloadTabs(groupHeading, false);

        groupHeading.appendChild(windowHeading);
        groupHeading.appendChild(groupUnsuspendCurrent);
        groupHeading.appendChild(groupUnsuspendNew);

        return groupHeading;
    }

    function createTabHtml(tabProperties, recoveryMode) {

        var linksSpan,
            listImg,
            listLink,
            listHover,
            favicon = false;

        recoveryMode = recoveryMode || false;

        //try to get best favicon url path
        if (tabProperties.favicon) {
            favicon = tabProperties.favicon;
        } else if (tabProperties.favIconUrl && tabProperties.favIconUrl.indexOf('chrome://theme') < 0) {
            favicon = tabProperties.favIconUrl;
        } else {
            favicon = 'chrome://favicon/' + tabProperties.url;
        }

        if (tabProperties.sessionId) {
            linksSpan = createEl('div', {
                'class': 'recoveryLink',
                'data-tabId': tabProperties.id || tabProperties.url,
                'data-windowId': tabProperties.windowId,
                'data-sessionId': tabProperties.sessionId,
                'data-url': tabProperties.url
            });
        } else {
            linksSpan = createEl('div', {
                'class': 'recoveryLink',
                'data-url': tabProperties.url
            });
        }

        listHover = createEl('img', {
            'src': chrome.extension.getURL('/img/x.gif'),
            'class': 'itemHover'
        });
        listHover.onclick = removeTab(linksSpan);

        listImg = createEl('img', {
            'src': favicon,
            'height': '16px',
            'width': '16px'
        });

        listLink = createEl('a', {
            'class': 'historyLink',
            'href': tabProperties.url,
            'target': '_blank'
        }, tabProperties.title);

        if (!recoveryMode) linksSpan.appendChild(listHover);
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
        return text + (count > 1 ? 's' : '');
    }

    return {
        createSessionHtml: createSessionHtml,
        createTabHtml: createTabHtml,
        hideModal: hideModal
    };

}());
