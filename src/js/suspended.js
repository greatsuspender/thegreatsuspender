/*global window, document, chrome, Image, XMLHttpRequest */
(function() {
  'use strict';

  const DEFAULT_FAVICON = chrome.extension.getURL('img/default.png');

  let isInitialised = false;
  let isLowContrastFavicon = false;
  let tabId;
  let requestUnsuspendOnReload = false;
  let previewUri;
  let scrollPosition;

  let showingNag;
  let builtImagePreview;

  let currentPreviewMode;
  let currentTitle;
  let currentUrl;
  let currentFavicon;
  let currentTheme;
  let currentShowNag;
  let currentCommand;
  let currentReason;

  async function preInit() {
    const href = window.location.href;
    const titleRegex = /ttl=([^&]*)/;
    const scrollPosRegex = /pos=([^&]*)/;
    const urlRegex = /uri=(.*)/;

    // Show suspended tab contents after max 1 second regardless
    window.setTimeout(() => {
      document.querySelector('body').classList.remove('hide-initially');
    }, 1000);

    const preTitleEncoded = href.match(titleRegex)
      ? href.match(titleRegex)[1]
      : null;
    if (preTitleEncoded) {
      const decodedPreTitle = decodeURIComponent(preTitleEncoded);
      setTitle(decodedPreTitle);
    }

    const preUrlEncoded = href.match(urlRegex) ? href.match(urlRegex)[1] : null;
    const preUrlDecoded = preUrlEncoded
      ? decodeURIComponent(preUrlEncoded)
      : null;
    if (preUrlDecoded) {
      setUrl(preUrlDecoded);
      document.getElementById('gsTopBar').onmousedown = handleUnsuspendTab;
      document.getElementById('suspendedMsg').onclick = handleUnsuspendTab;
    }

    try {
      const gsStorage = chrome.extension.getBackgroundPage().gsStorage;
      const theme = gsStorage.getOption(gsStorage.THEME);
      setTheme(theme);
    } catch (error) {
      // console.error(error);
    }

    document.querySelector('body').classList.remove('hide-initially');

    if (preUrlDecoded) {
      const preFavicon = 'chrome://favicon/size/16@2x/' + preUrlDecoded;
      await setFavicon(preFavicon);
    }

    const preScrollPosition = href.match(scrollPosRegex)
      ? href.match(scrollPosRegex)[1]
      : null;
    if (preScrollPosition) {
      setScrollPosition(preScrollPosition);
    }
  }

  function init(_tabId) {
    tabId = _tabId;

    // beforeunload event will get fired if: the tab is refreshed, the url is changed, the tab is closed
    // set the tabFlag TF_UNSUSPEND_ON_RELOAD_URL so that a refresh will trigger an unsuspend
    // this will be ignored if the tab is being closed or if the tab is navigating to a new url,
    // and that new url does not match the TF_UNSUSPEND_ON_RELOAD_URL
    window.addEventListener('beforeunload', function(event) {
      if (requestUnsuspendOnReload) {
        try {
          const tgs = chrome.extension.getBackgroundPage().tgs;
          tgs.setTabFlagForTabId(
            _tabId,
            tgs.TF_UNSUSPEND_ON_RELOAD_URL,
            window.location.href
          );
        } catch (error) {
          // console.error(error);
        }
      }
    });
  }

  function setTitle(title) {
    if (currentTitle === title) {
      return;
    }
    currentTitle = title;
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
  }

  async function setFavicon(favicon) {
    if (currentFavicon === favicon) {
      return;
    }
    currentFavicon = favicon;
    const faviconMetaData = await getFaviconMetaData(favicon);
    isLowContrastFavicon = faviconMetaData.isDark;
    setContrast();
    document
      .getElementById('gsTopBarImg')
      .setAttribute('src', faviconMetaData.normalisedDataUrl);
    document
      .getElementById('gsFavicon')
      .setAttribute('href', faviconMetaData.transparentDataUrl);
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
    if (scrollPosition === newScrollPosition) {
      return;
    }
    scrollPosition = newScrollPosition;
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
      var donationPopupFocusListener = function(e) {
        if (e) {
          e.target.removeEventListener(
            'visibilitychange',
            donationPopupFocusListener
          );
        }

        //if user has donated since this page was first generated then dont display popup
        if (currentShowNag) {
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

  async function setPreviewMode(previewMode) {
    if (currentPreviewMode === previewMode) {
      return;
    }
    currentPreviewMode = previewMode;

    if (!builtImagePreview && previewMode !== '0' && previewUri) {
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
        previewImgEl.removeEventListener('error', onErrorHandler);
        resolve();
      };
      const onErrorHandler = function() {
        previewImgEl.removeEventListener('load', onLoadedHandler);
        previewImgEl.removeEventListener('error', onErrorHandler);
        resolve();
      };
      previewImgEl.setAttribute('src', previewUri);
      previewImgEl.addEventListener('load', onLoadedHandler);
      previewImgEl.addEventListener('error', onErrorHandler);
    });
  }

  function toggleImagePreviewVisibility() {
    if (!document.getElementById('gsPreview')) {
      return;
    }
    var overflow = currentPreviewMode === '2' ? 'auto' : 'hidden';
    document.body.style['overflow'] = overflow;

    if (currentPreviewMode === '0' || !previewUri) {
      document.getElementById('gsPreview').style.display = 'none';
      document.getElementById('suspendedMsg').style.display = 'flex';
      document.body.classList.remove('img-preview-mode');
    } else {
      document.getElementById('gsPreview').style.display = 'block';
      document.getElementById('suspendedMsg').style.display = 'none';
      document.body.classList.add('img-preview-mode');
    }

    const scrollImagePreview = currentPreviewMode === '2';
    if (scrollImagePreview && scrollPosition) {
      document.body.scrollTop = scrollPosition || 0;
      document.documentElement.scrollTop = scrollPosition || 0;
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
    var hotkeyEl = document.getElementById('hotkeyCommand');
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
    if (tabId) {
      try {
        const tgs = chrome.extension.getBackgroundPage().tgs;
        if (addToTemporaryWhitelist) {
          tgs.setTabFlagForTabId(tabId, tgs.TF_TEMP_WHITELIST_ON_RELOAD, true);
        }
      } catch (error) {
        // console.error(error);
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
    window.location.replace(currentUrl);
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
    var toastEl = document.createElement('div');
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
      // console.error(error);
    }
  }

  function loadDonationPopupTemplate() {
    showingNag = true;

    var popupEl = document.createElement('div');
    popupEl.innerHTML = document.getElementById('donateTemplate').innerHTML;

    var cssEl = popupEl.querySelector('#donateCss');
    var imgEl = popupEl.querySelector('#dudePopup');
    var bubbleEl = popupEl.querySelector('#donateBubble');
    // set display to 'none' to prevent TFOUC
    imgEl.style.display = 'none';
    bubbleEl.style.display = 'none';
    localiseHtml(bubbleEl);

    var headEl = document.getElementsByTagName('head')[0];
    var bodyEl = document.getElementsByTagName('body')[0];
    headEl.appendChild(cssEl);
    bodyEl.appendChild(imgEl);
    bodyEl.appendChild(bubbleEl);

    var request = new XMLHttpRequest();
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
    var match = urlStr.match(/\/?[?#]+/);
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

  function getFaviconMetaData(url) {
    return new Promise(resolve => {
      var img = new Image();

      img.onload = function() {
        var canvas, context;
        canvas = window.document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        context = canvas.getContext('2d');
        context.drawImage(img, 0, 0);

        var imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        var origDataArray = imageData.data;
        var normalisedDataArray = new Uint8ClampedArray(origDataArray);
        var transparentDataArray = new Uint8ClampedArray(origDataArray);
        var r, g, b, a;

        var fuzzy = 0.1;
        var light = 0;
        var dark = 0;
        var maxAlpha = 0;
        var maxRgb = 0;

        for (let x = 0; x < origDataArray.length; x += 4) {
          r = origDataArray[x];
          g = origDataArray[x + 1];
          b = origDataArray[x + 2];
          a = origDataArray[x + 3];

          let localMaxRgb = Math.max(Math.max(r, g), b);
          if (localMaxRgb < 128 || a < 128) dark++;
          else light++;
          maxAlpha = Math.max(a, maxAlpha);
          maxRgb = Math.max(localMaxRgb, maxRgb);
        }

        //saftey check to make sure image is not completely transparent
        if (maxAlpha === 0) {
          getFaviconMetaData(DEFAULT_FAVICON).then(resolve);
          return;
        }

        var darkLightDiff = (light - dark) / (canvas.width * canvas.height);
        var isDark = darkLightDiff + fuzzy < 0;
        var normaliserMultiple = 1 / (maxAlpha / 255);

        for (let x = 0; x < origDataArray.length; x += 4) {
          a = origDataArray[x + 3];
          normalisedDataArray[x + 3] = parseInt(a * normaliserMultiple, 10);
        }
        for (let x = 0; x < normalisedDataArray.length; x += 4) {
          a = normalisedDataArray[x + 3];
          transparentDataArray[x + 3] = parseInt(a * 0.5, 10);
        }

        imageData.data.set(normalisedDataArray);
        context.putImageData(imageData, 0, 0);
        var normalisedDataUrl = canvas.toDataURL('image/png');

        imageData.data.set(transparentDataArray);
        context.putImageData(imageData, 0, 0);
        var transparentDataUrl = canvas.toDataURL('image/png');

        resolve({
          isDark,
          normalisedDataUrl,
          transparentDataUrl,
        });
      };
      img.src = url || DEFAULT_FAVICON;
    });
  }

  function waitForDocumentReady() {
    return new Promise(function(resolve) {
      if (document.readyState !== 'loading') {
        resolve();
      } else {
        document.addEventListener('DOMContentLoaded', function() {
          resolve();
        });
      }
    });
  }

  function localiseHtml(parentEl) {
    var replaceFunc = function(match, p1) {
      return p1 ? chrome.i18n.getMessage(p1) : '';
    };
    Array.prototype.forEach.call(parentEl.getElementsByTagName('*'), el => {
      if (el.hasAttribute('data-i18n')) {
        el.innerHTML = el
          .getAttribute('data-i18n')
          .replace(/__MSG_(\w+)__/g, replaceFunc);
      }
      if (el.hasAttribute('data-i18n-tooltip')) {
        el.setAttribute(
          'data-i18n-tooltip',
          el
            .getAttribute('data-i18n-tooltip')
            .replace(/__MSG_(\w+)__/g, replaceFunc)
        );
      }
    });
  }

  function addMessageListeners() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      (async () => {
        switch (request.action) {
          case 'initSuspendedTab':
            await handleInitRequest(request);
            isInitialised = true;
            break;

          case 'updateSuspendedTab':
            await handleInitRequest(request);
            break;

          case 'unsuspendTab':
            unsuspendTab();
            break;

          case 'disableUnsuspendOnReload':
            requestUnsuspendOnReload = false;
            break;

          case 'tempWhitelist':
            unsuspendTab(true);
            break;

          case 'showNoConnectivityMessage':
            showNoConnectivityMessage();
            break;
        }
        sendResponse(buildReportTabStatePayload());
      })();
      return true; // force message sender to wait for sendResponse
    });
  }

  function buildReportTabStatePayload() {
    return {
      isInitialised,
      tabId,
      requestUnsuspendOnReload,
    };
  }

  async function handleInitRequest(request) {
    if (request.tabId && !tabId) {
      init(request.tabId);
    }
    if (request.hasOwnProperty('requestUnsuspendOnReload')) {
      requestUnsuspendOnReload = request.requestUnsuspendOnReload;
    }
    if (request.hasOwnProperty('previewUri')) {
      previewUri = request.previewUri;
    }
    if (request.hasOwnProperty('previewMode')) {
      await setPreviewMode(request.previewMode);
    }
    if (request.hasOwnProperty('theme')) {
      setTheme(request.theme);
    }
    if (request.hasOwnProperty('showNag')) {
      handleDonationPopup(request.showNag, request.tabActive);
    }
    if (request.hasOwnProperty('command')) {
      setCommand(request.command);
    }
    if (request.hasOwnProperty('favicon')) {
      await setFavicon(request.favicon);
    }
    if (request.hasOwnProperty('title')) {
      setTitle(request.title);
    }
    if (request.hasOwnProperty('url')) {
      setUrl(request.url);
    }
    if (request.hasOwnProperty('reason')) {
      setReason(request.reason);
    }
  }

  waitForDocumentReady().then(async () => {
    localiseHtml(document);
    await preInit();
    addMessageListeners();
  });
})();
