import {
  log,
  warning,
  getSuspendedTitle,
  htmlEncode,
  localiseHtml,
  getOriginalUrl,
  getSuspendedScrollPosition,
} from './gsUtils';
import { getSessionId } from './gsSession';
import { getFaviconMetaData } from './gsFavicon';
import {
  STATE_UNLOADED_URL,
  STATE_SHOW_NAG,
  STATE_SUSPEND_REASON,
  STATE_SCROLL_POS,
  setTabStatePropForTabId,
  getTabStatePropForTabId,
} from './gsTabState';
import { getSettings, NO_NAG, THEME, SCREEN_CAPTURE } from './gsStorage';
import { fetchPreviewImage } from './gsIndexedDb';
import {
  registerViewGlobal,
  VIEW_FUNC_SUSPENDED_TAB_UPDATE_COMMAND,
} from './gsViews';

import {
  unsuspendTab,
  isCurrentFocusedTab,
  getSuspensionToggleHotkey,
} from './gsTgs';

export const initTab = async (tab, tabView, { showNag, quickInit }) => {
  if (!tabView) {
    warning(tab.id, 'Could not get internalTabView for suspended tab');
  }
  const suspendedUrl = tab.url;

  // Set sessionId for subsequent checks
  tabView.document.sessionId = getSessionId();

  // Set title
  let title = getSuspendedTitle(suspendedUrl);
  if (title.indexOf('<') >= 0) {
    // Encode any raw html tags that might be used in the title
    title = htmlEncode(title);
  }
  setTitle(tabView.document, title);

  // Set faviconMeta
  const faviconMeta = await getFaviconMetaData(tab);
  setFaviconMeta(tabView.document, faviconMeta);

  if (quickInit) {
    return;
  }

  tabView.document;

  const options = getSettings();
  const originalUrl = getOriginalUrl(suspendedUrl);

  // Add event listeners
  setUnloadTabHandler(tabView.window, tab);
  setUnsuspendTabHandlers(tabView.document, tab);

  // Set imagePreview
  const previewMode = options[SCREEN_CAPTURE];
  const previewUri = await getPreviewUri(suspendedUrl);
  await toggleImagePreviewVisibility(
    tabView.document,
    tab,
    previewMode,
    previewUri
  );

  // Set theme
  const theme = options[THEME];
  const isLowContrastFavicon = faviconMeta.isDark;
  setTheme(tabView.document, theme, isLowContrastFavicon);

  // Set showNag
  if (!options[NO_NAG] && (showNag === undefined || showNag === null)) {
    //show dude and donate link (randomly 1 of 20 times)
    showNag = Math.random() > 0.95;
  }
  setTabStatePropForTabId(tab.id, STATE_SHOW_NAG, showNag);

  if (showNag) {
    queueDonationPopup(tabView.window, tabView.document, tab.active, tab.id);
  }

  // Set command
  const suspensionToggleHotkey = await getSuspensionToggleHotkey();
  setCommand(tabView.document, suspensionToggleHotkey);

  // Set url
  setUrl(tabView.document, originalUrl);

  // Set reason
  const suspendReasonInt = getTabStatePropForTabId(
    tab.id,
    STATE_SUSPEND_REASON
  );
  let suspendReason = null;
  if (suspendReasonInt === 3) {
    suspendReason = chrome.i18n.getMessage('js_suspended_low_memory');
  }
  setReason(tabView.document, suspendReason);

  // Show the view
  showContents(tabView.document);

  // Set scrollPosition (must come after showing page contents)
  const scrollPosition = getSuspendedScrollPosition(suspendedUrl);
  setScrollPosition(tabView.document, scrollPosition, previewMode);
  setTabStatePropForTabId(tab.id, STATE_SCROLL_POS, scrollPosition);
  // const whitelisted = checkWhiteList(originalUrl);
};

export const showNoConnectivityMessage = tabView => {
  if (!tabView.document.getElementById('disconnectedNotice')) {
    loadToastTemplate(tabView.document);
  }
  tabView.document.getElementById('disconnectedNotice').style.display = 'none';
  setTimeout(function() {
    tabView.document.getElementById('disconnectedNotice').style.display =
      'block';
  }, 50);
};

export const updateCommand = (tabView, suspensionToggleHotkey) => {
  setCommand(tabView.document, suspensionToggleHotkey);
};

export const updateTheme = (tabView, tab, theme, isLowContrastFavicon) => {
  setTheme(tabView.document, theme, isLowContrastFavicon);
};

export const updatePreviewMode = async (tabView, tab, previewMode) => {
  const previewUri = await getPreviewUri(tab.url);
  await toggleImagePreviewVisibility(
    tabView.document,
    tab,
    previewMode,
    previewUri
  );

  const scrollPosition = getSuspendedScrollPosition(tab.url);
  setScrollPosition(tabView.document, scrollPosition, previewMode);
};

export const showContents = _document => {
  _document.querySelector('body').classList.remove('hide-initially');
};

export const setScrollPosition = (_document, scrollPosition, previewMode) => {
  const scrollPosAsInt = (scrollPosition && parseInt(scrollPosition)) || 0;
  const scrollImagePreview = previewMode === '2';
  if (scrollImagePreview && scrollPosAsInt > 15) {
    const offsetScrollPosition = scrollPosAsInt + 151;
    _document.body.scrollTop = offsetScrollPosition;
    _document.documentElement.scrollTop = offsetScrollPosition;
  } else {
    _document.body.scrollTop = 0;
    _document.documentElement.scrollTop = 0;
  }
};

export const setTitle = (_document, title) => {
  _document.title = title;
  _document.getElementById('gsTitle').innerHTML = title;
  _document.getElementById('gsTopBarTitle').innerHTML = title;
  // Prevent unsuspend by parent container
  // Using mousedown event otherwise click can still be triggered if
  // mouse is released outside of this element
  _document.getElementById('gsTopBarTitle').onmousedown = function(e) {
    e.stopPropagation();
  };
};

export const setUrl = (_document, url) => {
  _document.getElementById('gsTopBarUrl').innerHTML = cleanUrl(url);
  _document.getElementById('gsTopBarUrl').setAttribute('href', url);
  _document.getElementById('gsTopBarUrl').onmousedown = function(e) {
    e.stopPropagation();
  };
};

export const setFaviconMeta = (_document, faviconMeta) => {
  _document
    .getElementById('gsTopBarImg')
    .setAttribute('src', faviconMeta.normalisedDataUrl);
  _document
    .getElementById('gsFavicon')
    .setAttribute('href', faviconMeta.transparentDataUrl);
};

export const setTheme = (_document, theme, isLowContrastFavicon) => {
  if (theme === 'dark') {
    _document.querySelector('body').classList.add('dark');
  } else {
    _document.querySelector('body').classList.remove('dark');
  }

  if (theme === 'dark' && isLowContrastFavicon) {
    _document
      .getElementById('faviconWrap')
      .classList.add('faviconWrapLowContrast');
  } else {
    _document
      .getElementById('faviconWrap')
      .classList.remove('faviconWrapLowContrast');
  }
};

export const setReason = (_document, reason) => {
  let reasonMsgEl = _document.getElementById('reasonMsg');
  if (!reasonMsgEl) {
    reasonMsgEl = _document.createElement('div');
    reasonMsgEl.setAttribute('id', 'reasonMsg');
    reasonMsgEl.classList.add('reasonMsg');
    const containerEl = _document.getElementById('suspendedMsg-instr');
    containerEl.insertBefore(reasonMsgEl, containerEl.firstChild);
  }
  reasonMsgEl.innerHTML = reason;
};

export const queueDonationPopup = (_window, _document, tabActive, tabId) => {
  const donationPopupFocusListener = function(e) {
    if (e && e.target && e.target.visibilityState === 'hidden') {
      return;
    }
    const options = getSettings();
    const showNag =
      getTabStatePropForTabId(tabId, STATE_SHOW_NAG) && !options[NO_NAG];
    const dudeEl = _document.getElementById('dudePopup');
    const showingNag = dudeEl !== null && dudeEl.classList.contains('poppedup');

    if (showNag && !showingNag) {
      loadDonationPopupTemplate(_document);
    } else if (!showNag && showingNag) {
      hideDonationPopup(_document);
    }
  };

  _window.addEventListener('visibilitychange', donationPopupFocusListener);
  if (tabActive) {
    donationPopupFocusListener();
  }
};

export const hideDonationPopup = _document => {
  _document.getElementById('dudePopup').classList.remove('poppedup');
  _document.getElementById('donateBubble').classList.remove('fadeIn');
};

export const getPreviewUri = async suspendedUrl => {
  const originalUrl = getOriginalUrl(suspendedUrl);
  const preview = await fetchPreviewImage(originalUrl);
  let previewUri = null;
  if (
    preview &&
    preview.img &&
    preview.img !== null &&
    preview.img !== 'data:,' &&
    preview.img.length > 10000
  ) {
    previewUri = preview.img;
  }
  return previewUri;
};

export const buildImagePreview = (_document, tab, previewUri) => {
  return new Promise(resolve => {
    const previewEl = _document.createElement('div');
    const bodyEl = _document.getElementsByTagName('body')[0];
    previewEl.setAttribute('id', 'gsPreviewContainer');
    previewEl.classList.add('gsPreviewContainer');
    previewEl.innerHTML = _document.getElementById('previewTemplate').innerHTML;
    const unsuspendTabHandler = buildUnsuspendTabHandler(_document, tab);
    previewEl.onclick = unsuspendTabHandler;
    localiseHtml(previewEl);
    bodyEl.appendChild(previewEl);

    const previewImgEl = _document.getElementById('gsPreviewImg');
    const onLoadedHandler = function() {
      previewImgEl.removeEventListener('load', onLoadedHandler);
      previewImgEl.removeEventListener('error', onLoadedHandler);
      resolve();
    };
    previewImgEl.setAttribute('src', previewUri);
    previewImgEl.addEventListener('load', onLoadedHandler);
    previewImgEl.addEventListener('error', onLoadedHandler);
  });
};

export const addWatermarkHandler = _document => {
  _document.querySelector('.watermark').onclick = () => {
    chrome.tabs.create({ url: chrome.extension.getURL('about.html') });
  };
};

async function toggleImagePreviewVisibility(
  _document,
  tab,
  previewMode,
  previewUri
) {
  const builtImagePreview =
    _document.getElementById('gsPreviewContainer') !== null;
  if (!builtImagePreview && previewUri && previewMode && previewMode !== '0') {
    await buildImagePreview(_document, tab, previewUri);
  } else {
    addWatermarkHandler(_document);
  }

  if (!_document.getElementById('gsPreviewContainer')) {
    return;
  }
  const overflow = previewMode === '2' ? 'auto' : 'hidden';
  _document.body.style['overflow'] = overflow;

  if (previewMode === '0' || !previewUri) {
    _document.getElementById('gsPreviewContainer').style.display = 'none';
    _document.getElementById('suspendedMsg').style.display = 'flex';
    _document.body.classList.remove('img-preview-mode');
  } else {
    _document.getElementById('gsPreviewContainer').style.display = 'block';
    _document.getElementById('suspendedMsg').style.display = 'none';
    _document.body.classList.add('img-preview-mode');
  }
}

export const setCommand = (_document, command) => {
  const hotkeyEl = _document.getElementById('hotkeyWrapper');
  if (command) {
    hotkeyEl.innerHTML = '<span class="hotkeyCommand">(' + command + ')</span>';
  } else {
    const reloadString = chrome.i18n.getMessage(
      'js_suspended_hotkey_to_reload'
    );
    hotkeyEl.innerHTML = `<a id="setKeyboardShortcut" href="#">${reloadString}</a>`;
  }
};

export const setUnloadTabHandler = (_window, tab) => {
  // beforeunload event will get fired if: the tab is refreshed, the url is changed,
  // the tab is closed, or the tab is frozen by chrome ??
  // when this happens the STATE_UNLOADED_URL gets set with the suspended tab url
  // if the tab is refreshed, then on reload the url will match and the tab will unsuspend
  // if the url is changed then on reload the url will not match
  // if the tab is closed, the reload will never occur
  _window.addEventListener('beforeunload', function() {
    log(tab.id, 'BeforeUnload triggered: ' + tab.url);
    if (isCurrentFocusedTab(tab)) {
      setTabStatePropForTabId(tab.id, STATE_UNLOADED_URL, tab.url);
    } else {
      log(tab.id, 'Ignoring beforeUnload as tab is not currently focused.');
    }
  });
};

export const setUnsuspendTabHandlers = (_document, tab) => {
  const unsuspendTabHandler = buildUnsuspendTabHandler(_document, tab);
  _document.getElementById('gsTopBarUrl').onclick = unsuspendTabHandler;
  _document.getElementById('gsTopBar').onmousedown = unsuspendTabHandler;
  _document.getElementById('suspendedMsg').onclick = unsuspendTabHandler;
};

export const buildUnsuspendTabHandler = (_document, tab) => {
  return function(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.target.id === 'setKeyboardShortcut') {
      chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    } else if (e.which === 1) {
      showUnsuspendAnimation(_document);
      unsuspendTab(tab);
    }
  };
};

export const showUnsuspendAnimation = _document => {
  if (_document.body.classList.contains('img-preview-mode')) {
    _document.getElementById('refreshSpinner').classList.add('spinner');
  } else {
    _document.body.classList.add('waking');
    _document.getElementById('snoozyImg').src = chrome.extension.getURL(
      'img/snoozy_tab_awake.svg'
    );
    _document.getElementById('snoozySpinner').classList.add('spinner');
  }
};

export const loadToastTemplate = _document => {
  const toastEl = _document.createElement('div');
  toastEl.setAttribute('id', 'disconnectedNotice');
  toastEl.classList.add('toast-wrapper');
  toastEl.innerHTML = _document.getElementById('toastTemplate').innerHTML;
  localiseHtml(toastEl);
  _document.getElementsByTagName('body')[0].appendChild(toastEl);
};

export const loadDonationPopupTemplate = _document => {
  const popupEl = _document.createElement('div');
  popupEl.innerHTML = _document.getElementById('donateTemplate').innerHTML;

  const cssEl = popupEl.querySelector('#donateCss');
  const imgEl = popupEl.querySelector('#dudePopup');
  const bubbleEl = popupEl.querySelector('#donateBubble');
  // set display to 'none' to prevent TFOUC
  imgEl.style.display = 'none';
  bubbleEl.style.display = 'none';
  localiseHtml(bubbleEl);

  const headEl = _document.getElementsByTagName('head')[0];
  const bodyEl = _document.getElementsByTagName('body')[0];
  headEl.appendChild(cssEl);
  bodyEl.appendChild(imgEl);
  bodyEl.appendChild(bubbleEl);

  const request = new XMLHttpRequest();
  request.onload = () => {
    loadDonateButtonsHtml(_document, request.responseText);
  };
  request.open('GET', 'support.html', true);
  request.send();

  _document.getElementById('dudePopup').classList.add('poppedup');
  _document.getElementById('donateBubble').classList.add('fadeIn');
};

export const loadDonateButtonsHtml = (_document, responseText) => {
  _document.getElementById('donateButtons').innerHTML = responseText;
  _document.getElementById('bitcoinBtn').innerHTML = chrome.i18n.getMessage(
    'js_donate_bitcoin'
  );
  _document.getElementById('patreonBtn').innerHTML = chrome.i18n.getMessage(
    'js_donate_patreon'
  );
  _document
    .getElementById('paypalBtn')
    .setAttribute('value', chrome.i18n.getMessage('js_donate_paypal'));
  try {
    const gsAnalytics = chrome.extension.getBackgroundPage().gsAnalytics;
    _document.getElementById('bitcoinBtn').onclick = function() {
      gsAnalytics.reportEvent('Donations', 'Click', 'coinbase');
    };
    _document.getElementById('patreonBtn').onclick = function() {
      gsAnalytics.reportEvent('Donations', 'Click', 'patreon');
    };
    _document.getElementById('paypalBtn').onclick = function() {
      gsAnalytics.reportEvent('Donations', 'Click', 'paypal');
    };
  } catch (error) {
    warning(error);
  }
};

export const cleanUrl = urlStr => {
  // remove scheme
  if (urlStr.indexOf('//') > 0) {
    urlStr = urlStr.substring(urlStr.indexOf('//') + 2);
  }
  // remove query string
  let match = urlStr.match(/\/?[?#]+/);
  if (match) {
    urlStr = urlStr.substring(0, match.index);
  }
  // remove trailing slash
  match = urlStr.match(/\/$/);
  if (match) {
    urlStr = urlStr.substring(0, match.index);
  }
  return urlStr;
};

registerViewGlobal(
  window,
  VIEW_FUNC_SUSPENDED_TAB_UPDATE_COMMAND,
  updateCommand
);
