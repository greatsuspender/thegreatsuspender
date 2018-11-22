/*global window, document, chrome, Image, XMLHttpRequest, tgs, gsTabSuspendManager, gsUtils, gsSession, gsTabSuspendManager */
(function(global) {
  'use strict';

  let unloadListener;
  let isLowContrastFavicon = false;
  let requestUnsuspendOnReload = true;

  let showingNag;
  let builtImagePreview;

  let currentTabId;
  let currentPreviewMode;
  let currentPreviewUri;
  let currentTitle;
  let currentUrl;
  let currentScrollPosition;
  let currentFaviconMeta;
  let currentTheme;
  let currentShowNag;
  let currentCommand;
  let currentReason;

  function preInit() {
    const preInitProps = buildFallbackPropsFromHref(
      window.location.href,
      false
    );
    initTabProps(preInitProps);
  }

  function fallbackInit() {
    const fallbackInitProps = buildFallbackPropsFromHref(
      window.location.href,
      true
    );
    logError('Falling back on href props:', fallbackInitProps);
    initTabProps(fallbackInitProps);
  }

  function showContents() {
    document.querySelector('body').classList.remove('hide-initially');
  }

  // AFAIK this is the only way to find out the chrome tabId
  function fetchTabMeta() {
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage({ action: 'requestTabMeta' }, tab => {
          if (chrome.runtime.lastError) {
            logError(chrome.runtime.lastError);
          }
          resolve(tab);
        });
      } catch (e) {
        logError(e);
        resolve();
      }
    });
  }

  function buildFallbackPropsFromHref(href, includeFaviconMeta) {
    const initProps = {};

    const titleRegex = /ttl=([^&]*)/;
    const titleEncoded = href.match(titleRegex)
      ? href.match(titleRegex)[1]
      : null;
    const title = titleEncoded ? decodeURIComponent(titleEncoded) : null;

    const urlRegex = /uri=(.*)/;
    const urlEncoded = href.match(urlRegex) ? href.match(urlRegex)[1] : null;
    const url = urlEncoded ? decodeURIComponent(urlEncoded) : null;

    const scrollPosRegex = /pos=([^&]*)/;
    const scrollPosition = href.match(scrollPosRegex)
      ? href.match(scrollPosRegex)[1]
      : null;

    if (!currentUrl && url) {
      initProps.url = url;
    }
    if (!currentTitle) {
      if (title) {
        initProps.title = title;
      } else if (url) {
        initProps.title = url;
      }
    }
    if (!currentScrollPosition && scrollPosition) {
      initProps.scrollPosition = scrollPosition;
    }
    if (includeFaviconMeta && !currentFaviconMeta && url) {
      const favIconUrl = 'chrome://favicon/size/16@2x/' + url;
      initProps.faviconMeta = {
        isDark: false,
        normalisedDataUrl: favIconUrl,
        transparentDataUrl: favIconUrl,
      };
    }
    return initProps;
  }

  function initTabProps(initProps) {
    if (initProps.hasOwnProperty('tabId')) {
      setTabId(initProps.tabId);
    }
    if (initProps.hasOwnProperty('previewUri')) {
      setPreviewUri(initProps.previewUri); // async. unhandled promise.
    }
    if (initProps.hasOwnProperty('previewMode')) {
      setPreviewMode(initProps.previewMode); // async. unhandled promise.
    }
    if (initProps.hasOwnProperty('theme')) {
      setTheme(initProps.theme);
    }
    if (initProps.hasOwnProperty('showNag')) {
      handleDonationPopup(initProps.showNag, initProps.tabActive);
    }
    if (initProps.hasOwnProperty('command')) {
      setCommand(initProps.command);
    }
    if (initProps.hasOwnProperty('faviconMeta')) {
      setFaviconMeta(initProps.faviconMeta);
    }
    if (initProps.hasOwnProperty('title')) {
      setTitle(initProps.title);
    }
    if (initProps.hasOwnProperty('url')) {
      setUrl(initProps.url);
    }
    if (initProps.hasOwnProperty('scrollPosition')) {
      setScrollPosition(initProps.scrollPosition);
    }
    if (initProps.hasOwnProperty('reason')) {
      setReason(initProps.reason);
    }
  }

  function setTabId(tabId) {
    currentTabId = tabId;
  }

  function setTitle(title) {
    if (currentTitle === title) {
      return;
    }
    document.getElementById('gsTitle').innerHTML = title;
    document.getElementById('gsTopBarTitle').innerHTML = title;
    // Prevent unsuspend by parent container
    // Using mousedown event otherwise click can still be triggered if
    // mouse is released outside of this element
    document.getElementById('gsTopBarTitle').onmousedown = function(e) {
      e.stopPropagation();
    };
  }

  function setUrl(url) {
    if (currentUrl === url) {
      return;
    }
    currentUrl = url;
    document.getElementById('gsTopBarUrl').innerHTML = cleanUrl(currentUrl);
    document.getElementById('gsTopBarUrl').setAttribute('href', url);
    document.getElementById('gsTopBarUrl').onmousedown = function(e) {
      e.stopPropagation();
    };
    document.getElementById('gsTopBarUrl').onclick = handleUnsuspendTab;
    document.getElementById('gsTopBar').onmousedown = handleUnsuspendTab;
    document.getElementById('suspendedMsg').onclick = handleUnsuspendTab;
  }

  function setFaviconMeta(faviconMeta) {
    if (
      currentFaviconMeta &&
      currentFaviconMeta.isDark === faviconMeta.isDark &&
      currentFaviconMeta.normalisedDataUrl === faviconMeta.normalisedDataUrl &&
      currentFaviconMeta.transparentDataUrl === faviconMeta.transparentDataUrl
    ) {
      return;
    }
    currentFaviconMeta = faviconMeta;

    isLowContrastFavicon = faviconMeta.isDark;
    setContrast();
    document
      .getElementById('gsTopBarImg')
      .setAttribute('src', faviconMeta.normalisedDataUrl);
    document
      .getElementById('gsFavicon')
      .setAttribute('href', faviconMeta.transparentDataUrl);
  }

  function setContrast() {
    if (currentTheme === 'dark' && isLowContrastFavicon) {
      document
        .getElementById('faviconWrap')
        .classList.add('faviconWrapLowContrast');
    } else {
      document
        .getElementById('faviconWrap')
        .classList.remove('faviconWrapLowContrast');
    }
  }

  function setScrollPosition(newScrollPosition) {
    if (currentScrollPosition === newScrollPosition) {
      return;
    }
    currentScrollPosition = newScrollPosition;
  }

  function setTheme(newTheme) {
    if (currentTheme === newTheme) {
      return;
    }
    currentTheme = newTheme;
    if (newTheme === 'dark') {
      document.querySelector('body').classList.add('dark');
    } else {
      document.querySelector('body').classList.remove('dark');
    }
    setContrast();
  }

  function setReason(reason) {
    if (currentReason === reason) {
      return;
    }
    currentReason = reason;
    let reasonMsgEl = document.getElementById('reasonMsg');
    if (!reasonMsgEl) {
      reasonMsgEl = document.createElement('div');
      reasonMsgEl.setAttribute('id', 'reasonMsg');
      reasonMsgEl.classList.add('reasonMsg');
      const containerEl = document.getElementById('suspendedMsg-instr');
      containerEl.insertBefore(reasonMsgEl, containerEl.firstChild);
    }
    reasonMsgEl.innerHTML = reason;
  }

  function handleDonationPopup(showNag, tabActive) {
    const queueNag = showNag && !showingNag && currentShowNag !== showNag;
    currentShowNag = showNag;

    if (queueNag) {
      const donationPopupFocusListener = function(e) {
        if (e) {
          e.target.removeEventListener(
            'visibilitychange',
            donationPopupFocusListener
          );
        }

        //if user has donated since this page was first generated then dont display popup
        if (showNag) {
          loadDonationPopupTemplate();
        }
      };
      if (tabActive) {
        donationPopupFocusListener();
      } else {
        window.addEventListener('visibilitychange', donationPopupFocusListener);
      }
    } else if (showNag && showingNag) {
      showingNag = false;
      document.getElementById('dudePopup').classList.remove('poppedup');
      document.getElementById('donateBubble').classList.remove('fadeIn');
    }
  }

  async function setPreviewUri(previewUri) {
    if (currentPreviewUri === previewUri) {
      return;
    }
    currentPreviewUri = previewUri;
    await updateImagePreview();
  }

  async function setPreviewMode(previewMode) {
    if (currentPreviewMode === previewMode) {
      return;
    }
    currentPreviewMode = previewMode;
    await updateImagePreview();
  }

  async function updateImagePreview() {
    if (
      !builtImagePreview &&
      currentPreviewUri &&
      currentPreviewMode &&
      currentPreviewMode !== '0'
    ) {
      await buildImagePreview();
      toggleImagePreviewVisibility();
    } else {
      toggleImagePreviewVisibility();
      document.querySelector('.watermark').addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.extension.getURL('about.html') });
      });
    }
  }

  function buildImagePreview() {
    return new Promise(resolve => {
      const previewEl = document.createElement('div');
      previewEl.innerHTML = document.getElementById(
        'previewTemplate'
      ).innerHTML;
      localiseHtml(previewEl);
      previewEl.onclick = handleUnsuspendTab;
      document.getElementsByTagName('body')[0].appendChild(previewEl);
      builtImagePreview = true;

      const previewImgEl = document.getElementById('gsPreviewImg');
      const onLoadedHandler = function() {
        previewImgEl.removeEventListener('load', onLoadedHandler);
        previewImgEl.removeEventListener('error', onLoadedHandler);
        resolve();
      };
      previewImgEl.setAttribute('src', currentPreviewUri);
      previewImgEl.addEventListener('load', onLoadedHandler);
      previewImgEl.addEventListener('error', onLoadedHandler);
    });
  }

  function toggleImagePreviewVisibility() {
    if (!document.getElementById('gsPreview')) {
      return;
    }
    const overflow = currentPreviewMode === '2' ? 'auto' : 'hidden';
    document.body.style['overflow'] = overflow;

    if (currentPreviewMode === '0' || !currentPreviewUri) {
      document.getElementById('gsPreview').style.display = 'none';
      document.getElementById('suspendedMsg').style.display = 'flex';
      document.body.classList.remove('img-preview-mode');
    } else {
      document.getElementById('gsPreview').style.display = 'block';
      document.getElementById('suspendedMsg').style.display = 'none';
      document.body.classList.add('img-preview-mode');
    }

    const scrollImagePreview = currentPreviewMode === '2';
    if (scrollImagePreview && currentScrollPosition) {
      document.body.scrollTop = currentScrollPosition || 0;
      document.documentElement.scrollTop = currentScrollPosition || 0;
    } else {
      document.body.scrollTop = 0;
      document.documentElement.scrollTop = 0;
    }
  }

  function setCommand(command) {
    if (currentCommand === command) {
      return;
    }
    currentCommand = command;
    const hotkeyEl = document.getElementById('hotkeyCommand');
    if (command) {
      hotkeyEl.innerHTML = '(' + command + ')';
    } else {
      const reloadString = chrome.i18n.getMessage(
        'js_suspended_hotkey_to_reload'
      );
      hotkeyEl.innerHTML = `<a id="setKeyboardShortcut" href="#">${reloadString}</a>`;
    }
  }

  function handleUnsuspendTab(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.target.id === 'setKeyboardShortcut') {
      chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    } else if (e.which === 1) {
      unsuspendTab();
    }
  }

  function unsuspendTab(addToTemporaryWhitelist) {
    if (currentTabId && addToTemporaryWhitelist) {
      try {
        tgs.setSuspendedTabPropForTabId(
          currentTabId,
          tgs.STP_TEMP_WHITELIST_ON_RELOAD,
          true
        );
      } catch (e) {
        logError(e);
      }
    }

    if (document.body.classList.contains('img-preview-mode')) {
      document.getElementById('refreshSpinner').classList.add('spinner');
    } else {
      document.body.classList.add('waking');
      document.getElementById('snoozyImg').src = chrome.extension.getURL(
        'img/snoozy_tab_awake.svg'
      );
      document.getElementById('snoozySpinner').classList.add('spinner');
    }
    if (!currentUrl) {
      logError('currentUrl not set!');
      fallbackInit();
    }
    window.removeEventListener('beforeunload', unloadListener);
    window.location.replace(currentUrl);
  }

  function disableUnsuspendOnReload() {
    requestUnsuspendOnReload = false;
  }

  function showNoConnectivityMessage() {
    if (!document.getElementById('disconnectedNotice')) {
      loadToastTemplate();
    }
    document.getElementById('disconnectedNotice').style.display = 'none';
    setTimeout(function() {
      document.getElementById('disconnectedNotice').style.display = 'block';
    }, 50);
  }

  function loadToastTemplate() {
    const toastEl = document.createElement('div');
    toastEl.setAttribute('id', 'disconnectedNotice');
    toastEl.classList.add('toast-wrapper');
    toastEl.innerHTML = document.getElementById('toastTemplate').innerHTML;
    localiseHtml(toastEl);
    document.getElementsByTagName('body')[0].appendChild(toastEl);
  }

  function loadDonateButtonsHtml() {
    document.getElementById('donateButtons').innerHTML = this.responseText;
    document.getElementById('bitcoinBtn').innerHTML = chrome.i18n.getMessage(
      'js_donate_bitcoin'
    );
    document.getElementById('patreonBtn').innerHTML = chrome.i18n.getMessage(
      'js_donate_patreon'
    );
    document
      .getElementById('paypalBtn')
      .setAttribute('value', chrome.i18n.getMessage('js_donate_paypal'));
    try {
      const gsAnalytics = chrome.extension.getBackgroundPage().gsAnalytics;
      document.getElementById('bitcoinBtn').onclick = function() {
        gsAnalytics.reportEvent('Donations', 'Click', 'coinbase');
      };
      document.getElementById('patreonBtn').onclick = function() {
        gsAnalytics.reportEvent('Donations', 'Click', 'patreon');
      };
      document.getElementById('paypalBtn').onclick = function() {
        gsAnalytics.reportEvent('Donations', 'Click', 'paypal');
      };
    } catch (error) {
      logError(error);
    }
  }

  function loadDonationPopupTemplate() {
    showingNag = true;

    const popupEl = document.createElement('div');
    popupEl.innerHTML = document.getElementById('donateTemplate').innerHTML;

    const cssEl = popupEl.querySelector('#donateCss');
    const imgEl = popupEl.querySelector('#dudePopup');
    const bubbleEl = popupEl.querySelector('#donateBubble');
    // set display to 'none' to prevent TFOUC
    imgEl.style.display = 'none';
    bubbleEl.style.display = 'none';
    localiseHtml(bubbleEl);

    const headEl = document.getElementsByTagName('head')[0];
    const bodyEl = document.getElementsByTagName('body')[0];
    headEl.appendChild(cssEl);
    bodyEl.appendChild(imgEl);
    bodyEl.appendChild(bubbleEl);

    const request = new XMLHttpRequest();
    request.onload = loadDonateButtonsHtml;
    request.open('GET', 'support.html', true);
    request.send();

    document.getElementById('dudePopup').classList.add('poppedup');
    document.getElementById('donateBubble').classList.add('fadeIn');
  }

  function cleanUrl(urlStr) {
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
  }

  function localiseHtml(parentEl) {
    const replaceTagFunc = function(match, p1) {
      return p1 ? chrome.i18n.getMessage(p1) : '';
    };
    Array.prototype.forEach.call(parentEl.getElementsByTagName('*'), el => {
      if (el.hasAttribute('data-i18n')) {
        el.innerHTML = el
          .getAttribute('data-i18n')
          .replace(/__MSG_(\w+)__/g, replaceTagFunc)
          .replace(/\n/g, '<br />');
      }
    });
  }

  function getUnloadListener() {
    // beforeunload event will get fired if:
    // the tab is refreshed, the url is changed, or the tab is closed.
    // set the tabFlag STP_UNSUSPEND_ON_RELOAD_URL so that a refresh will trigger an unsuspend
    // this will be ignored if the tab is being closed or if the tab is navigating to a new url,
    // and that new url does not match the STP_UNSUSPEND_ON_RELOAD_URL
    return function(event) {
      if (!currentTabId) {
        logError('currentTabId not defined');
        return;
      }
      if (requestUnsuspendOnReload) {
        try {
          tgs.setSuspendedTabPropForTabId(
            currentTabId,
            tgs.STP_UNSUSPEND_ON_RELOAD_URL,
            window.location.href
          );
        } catch (e) {
          logError(e);
        }
      }
    };
  }

  function logError(error) {
    try {
      const id = currentTabId || currentUrl;
      gsUtils.warning(id, 'Suspended tab error: ', error);
    } catch (e) {
      console.log(error);
    }
  }

  global.exports = {
    initTabProps,
    showContents,
    unsuspendTab,
    disableUnsuspendOnReload,
    showNoConnectivityMessage,
  };

  unloadListener = getUnloadListener();
  window.addEventListener('beforeunload', unloadListener);
  localiseHtml(document);
  preInit();
  try {
    chrome.extension
      .getBackgroundPage()
      .tgs.setViewGlobals(global, 'suspended');

    if (gsSession.isInitialising()) {
      // do nothing as we rely on gsSession startup to handle init
    } else {
      fetchTabMeta().then(tabMeta => {
        setTabId(tabMeta.id);
        gsTabSuspendManager.initSuspendedTab(global, tabMeta); //async
      });
    }
  } catch (e) {
    logError(e);
    fallbackInit();
  }
})(this);
