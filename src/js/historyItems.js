/*global chrome, gsSession, gsUtils, gsFavicon */
// eslint-disable-next-line no-unused-vars
var historyItems = (function(global) {
  'use strict';

  if (
    !chrome.extension.getBackgroundPage() ||
    !chrome.extension.getBackgroundPage().tgs
  ) {
    return;
  }
  chrome.extension.getBackgroundPage().tgs.setViewGlobals(global);

  function createSessionHtml(session, showLinks) {
    session.windows = session.windows || [];

    var sessionType =
        session.sessionId === gsSession.getSessionId()
          ? 'current'
          : session.name
            ? 'saved'
            : 'recent',
      sessionContainer,
      sessionTitle,
      sessionSave,
      sessionDelete,
      sessionExport,
      sessionDiv,
      sessionIcon,
      windowResuspend,
      windowReload,
      titleText,
      winCnt = session.windows.length,
      tabCnt = session.windows.reduce(function(a, b) {
        return a + b.tabs.length;
      }, 0);

    if (sessionType === 'saved') {
      titleText = session.name;
    } else {
      titleText = gsUtils.getHumanDate(session.date);
    }
    titleText +=
      '&nbsp;&nbsp;<small>(' +
      winCnt +
      pluralise(
        ' ' + chrome.i18n.getMessage('js_history_window').toLowerCase(),
        winCnt
      ) +
      ', ' +
      tabCnt +
      pluralise(
        ' ' + chrome.i18n.getMessage('js_history_tab').toLowerCase(),
        tabCnt
      ) +
      ')</small>';

    sessionIcon = createEl('i', {
      class: 'sessionIcon icon icon-plus-squared-alt',
    });

    sessionDiv = createEl('div', {
      class: 'sessionContents',
    });

    sessionTitle = createEl('span', {
      class: 'sessionLink',
    });
    sessionTitle.innerHTML = titleText;

    sessionSave = createEl(
      'a',
      {
        class: 'groupLink saveLink',
        href: '#',
      },
      chrome.i18n.getMessage('js_history_save')
    );

    sessionDelete = createEl(
      'a',
      {
        class: 'groupLink deleteLink',
        href: '#',
      },
      chrome.i18n.getMessage('js_history_delete')
    );

    windowResuspend = createEl(
      'a',
      {
        class: 'groupLink resuspendLink',
        href: '#',
      },
      chrome.i18n.getMessage('js_history_resuspend')
    );

    windowReload = createEl(
      'a',
      {
        class: 'groupLink reloadLink',
        href: '#',
      },
      chrome.i18n.getMessage('js_history_reload')
    );

    sessionExport = createEl(
      'a',
      {
        class: 'groupLink exportLink',
        href: '#',
      },
      chrome.i18n.getMessage('js_history_export')
    );

    sessionContainer = createEl('div', {
      class: 'sessionContainer',
    });
    sessionContainer.appendChild(sessionIcon);
    sessionContainer.appendChild(sessionTitle);
    if (showLinks && sessionType !== 'current') {
      sessionContainer.appendChild(windowResuspend);
      sessionContainer.appendChild(windowReload);
    }
    if (showLinks) {
      sessionContainer.appendChild(sessionExport);
    }
    if (showLinks && sessionType !== 'saved') {
      sessionContainer.appendChild(sessionSave);
    }
    if (showLinks && sessionType !== 'current') {
      sessionContainer.appendChild(sessionDelete);
    }

    sessionContainer.appendChild(sessionDiv);

    return sessionContainer;
  }

  function createWindowHtml(window, index, showLinks) {
    var groupHeading, windowContainer, groupUnsuspendCurrent, groupUnsuspendNew;

    groupHeading = createEl('div', {
      class: 'windowContainer',
    });

    var windowString = chrome.i18n.getMessage('js_history_window');
    windowContainer = createEl(
      'span',
      {},
      windowString + ' ' + (index + 1) + ':\u00A0'
    );

    groupUnsuspendCurrent = createEl(
      'a',
      {
        class: 'groupLink resuspendLink ',
        href: '#',
      },
      chrome.i18n.getMessage('js_history_resuspend')
    );

    groupUnsuspendNew = createEl(
      'a',
      {
        class: 'groupLink reloadLink',
        href: '#',
      },
      chrome.i18n.getMessage('js_history_reload')
    );

    groupHeading.appendChild(windowContainer);
    if (showLinks) {
      groupHeading.appendChild(groupUnsuspendCurrent);
      groupHeading.appendChild(groupUnsuspendNew);
    }

    return groupHeading;
  }

  async function createTabHtml(tab, showLinks) {
    var linksSpan, listImg, listLink, listHover;

    if (tab.sessionId) {
      linksSpan = createEl('div', {
        class: 'tabContainer',
        'data-tabId': tab.id || tab.url,
        'data-url': tab.url,
      });
    } else {
      linksSpan = createEl('div', {
        class: 'tabContainer',
        'data-url': tab.url,
      });
    }

    listHover = createEl(
      'span',
      {
        class: 'itemHover removeLink',
      },
      '\u2716'
    );

    const faviconMeta = await gsFavicon.getFaviconMetaData(tab);
    const favIconUrl = faviconMeta.normalisedDataUrl;
    listImg = createEl('img', {
      src: favIconUrl,
      height: '16px',
      width: '16px',
    });

    listLink = createEl(
      'a',
      {
        class: 'historyLink',
        href: tab.url,
        target: '_blank',
      },
      tab.title && tab.title.length > 1 ? tab.title : tab.url
    );

    if (showLinks) {
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
    return (
      text + (count > 1 ? chrome.i18n.getMessage('js_history_plural') : '')
    );
  }

  return {
    createSessionHtml: createSessionHtml,
    createWindowHtml: createWindowHtml,
    createTabHtml: createTabHtml,
  };
})(this);
