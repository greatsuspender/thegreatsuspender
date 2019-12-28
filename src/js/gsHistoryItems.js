import { getSessionId } from './gsSession';
import { getHumanDate, htmlEncode, hasProperty } from './gsUtils';
import { getFaviconMetaData } from './gsFavicon';

export const createSessionHtml = (session, showLinks) => {
  session.windows = session.windows || [];

  const sessionType =
    session.sessionId === getSessionId()
      ? 'current'
      : session.name
      ? 'saved'
      : 'recent';
  const winCnt = session.windows.length;
  const tabCnt = session.windows.reduce(function(a, b) {
    return a + b.tabs.length;
  }, 0);

  let titleText;
  if (sessionType === 'saved') {
    titleText = session.name;
  } else {
    titleText = getHumanDate(session.date);
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

  const sessionIcon = createEl('i', {
    class: 'sessionIcon icon icon-plus-squared-alt',
  });

  const sessionDiv = createEl('div', {
    class: 'sessionContents',
  });

  const sessionTitle = createEl('span', {
    class: 'sessionLink',
  });
  sessionTitle.innerHTML = titleText;

  const sessionSave = createEl(
    'a',
    {
      class: 'groupLink saveLink',
      href: '#',
    },
    chrome.i18n.getMessage('js_history_save')
  );

  const sessionDelete = createEl(
    'a',
    {
      class: 'groupLink deleteLink',
      href: '#',
    },
    chrome.i18n.getMessage('js_history_delete')
  );

  const windowResuspend = createEl(
    'a',
    {
      class: 'groupLink resuspendLink',
      href: '#',
    },
    chrome.i18n.getMessage('js_history_resuspend')
  );

  const windowReload = createEl(
    'a',
    {
      class: 'groupLink reloadLink',
      href: '#',
    },
    chrome.i18n.getMessage('js_history_reload')
  );

  const sessionExport = createEl(
    'a',
    {
      class: 'groupLink exportLink',
      href: '#',
    },
    chrome.i18n.getMessage('js_history_export')
  );

  const sessionContainer = createEl('div', {
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
};

export const createWindowHtml = (window, index, showLinks) => {
  const groupHeading = createEl('div', {
    class: 'windowContainer',
  });

  const windowString = chrome.i18n.getMessage('js_history_window');
  const windowContainer = createEl(
    'span',
    {},
    windowString + ' ' + (index + 1) + ':\u00A0'
  );

  const groupUnsuspendCurrent = createEl(
    'a',
    {
      class: 'groupLink resuspendLink ',
      href: '#',
    },
    chrome.i18n.getMessage('js_history_resuspend')
  );

  const groupUnsuspendNew = createEl(
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
};

export const createTabHtml = async (tab, showLinks) => {
  let linksSpan;
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

  const listHover = createEl(
    'span',
    {
      class: 'itemHover removeLink',
    },
    '\u2716'
  );

  const faviconMeta = await getFaviconMetaData(tab);
  const favIconUrl = faviconMeta.normalisedDataUrl;
  const listImg = createEl('img', {
    src: favIconUrl,
    height: '16px',
    width: '16px',
  });

  const listLink = createEl(
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
};

function createEl(elType, attributes, text) {
  let el = document.createElement(elType);
  attributes = attributes || {};
  el = setElAttributes(el, attributes);
  el.innerHTML = htmlEncode(text || '');
  return el;
}
function setElAttributes(el, attributes) {
  for (const key in attributes) {
    if (hasProperty(attributes, key)) {
      el.setAttribute(key, attributes[key]);
    }
  }
  return el;
}

function pluralise(text, count) {
  return text + (count > 1 ? chrome.i18n.getMessage('js_history_plural') : '');
}
