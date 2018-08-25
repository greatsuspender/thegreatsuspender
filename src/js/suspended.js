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
  let currentFaviconUrl;
  let currentTheme;
  let currentHideNag;
  let currentCommand;

  function preInit() {
    const href = window.location.href;
    const titleRegex = /ttl=([^&]*)/;
    const urlRegex = /uri=(.*)/;

    const preTitleEncoded = href.match(titleRegex)
      ? href.match(titleRegex)[1]
      : null;
    if (preTitleEncoded) {
      const decodedPreTitle = decodeURIComponent(preTitleEncoded);
      setTitle(decodedPreTitle);
    }

    const preUrlEncoded = href.match(urlRegex) ? href.match(urlRegex)[1] : null;
    if (preUrlEncoded) {
      const preUrlDecoded = decodeURIComponent(preUrlEncoded);
      setUrl(preUrlDecoded);
      document.getElementById('gsTopBar').onmousedown = handleUnsuspendTab;
      document.getElementById('suspendedMsg').onmousedown = handleUnsuspendTab;

      const preFaviconUrl = 'chrome://favicon/' + preUrlDecoded;
      setFavicon(preFaviconUrl);
    }
  }

  function init(_tabId) {
    tabId = _tabId;

    // beforeunload event will get fired if: the tab is refreshed, the url is changed, the tab is closed
    // set the tabFlag UNSUSPEND_ON_RELOAD_URL so that a refresh will trigger an unsuspend
    // this will be ignored if the tab is being closed or if the tab is navigating to a new url,
    // and that new url does not match the UNSUSPEND_ON_RELOAD_URL
    window.addEventListener('beforeunload', function(event) {
      if (requestUnsuspendOnReload) {
        chrome.extension
          .getBackgroundPage()
          .tgs.setTabFlagForTabId(
            _tabId,
            chrome.extension.getBackgroundPage().tgs.UNSUSPEND_ON_RELOAD_URL,
            window.location.href
          );
      }
    });

    try {
      chrome.extension
        .getBackgroundPage()
        .gsAnalytics.reportPageView('suspended.html');
    } catch (error) {
      console.error(error);
    }
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
    document.getElementById('gsTopBarUrl').onmousedown = handleUnsuspendTab;
  }

  function setFavicon(faviconUrl) {
    if (currentFaviconUrl === faviconUrl) {
      return;
    }
    currentFaviconUrl = faviconUrl;
    getFaviconMetaData(faviconUrl, function(faviconMetaData) {
      isLowContrastFavicon = faviconMetaData.isDark;
      setContrast();
      document
        .getElementById('gsTopBarImg')
        .setAttribute('src', faviconMetaData.normalisedDataUrl);
      document
        .getElementById('gsFavicon')
        .setAttribute('href', faviconMetaData.transparentDataUrl);
    });
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

  function handleDonationPopup(hideNag) {
    const queueNag = !hideNag && !showingNag && currentHideNag !== hideNag;
    currentHideNag = hideNag;

    if (queueNag) {
      //show dude and donate link (randomly 1 of 20 times)
      if (Math.random() > 0.95) {
        var donationPopupFocusListener = function(e) {
          e.target.removeEventListener('focus', donationPopupFocusListener);

          //if user has donated since this page was first generated then dont display popup
          if (!currentHideNag) {
            loadDonationPopupTemplate();
          }
        };
        window.addEventListener('focus', donationPopupFocusListener);
      }
    } else if (hideNag && showingNag) {
      showingNag = false;
      document.getElementById('dudePopup').classList.remove('poppedup');
      document.getElementById('donateBubble').classList.remove('fadeIn');
    }
  }

  function setPreviewMode(previewMode) {
    if (currentPreviewMode === previewMode) {
      return;
    }
    currentPreviewMode = previewMode;

    if (!builtImagePreview && previewMode !== '0' && previewUri) {
      buildImagePreview(() => {
        toggleImagePreviewVisibility();
      });
    } else {
      toggleImagePreviewVisibility();
      document.querySelector('.watermark').addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.extension.getURL('about.html') });
      });
    }
  }

  function buildImagePreview(callback) {
    const previewEl = document.createElement('div');
    previewEl.innerHTML = document.getElementById('previewTemplate').innerHTML;
    localiseHtml(previewEl);
    previewEl.onmousedown = handleUnsuspendTab;
    document.getElementsByTagName('body')[0].appendChild(previewEl);
    builtImagePreview = true;

    const previewImgEl = document.getElementById('gsPreviewImg');
    const onLoadedHandler = function() {
      previewImgEl.removeEventListener('load', onLoadedHandler);
      previewImgEl.removeEventListener('error', onErrorHandler);
      callback();
    };
    const onErrorHandler = function() {
      previewImgEl.removeEventListener('load', onLoadedHandler);
      previewImgEl.removeEventListener('error', onErrorHandler);
      callback();
    };
    previewImgEl.setAttribute('src', previewUri);
    previewImgEl.addEventListener('load', onLoadedHandler);
    previewImgEl.addEventListener('error', onErrorHandler);
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
      chrome.tabs.create({ url: 'chrome://extensions/configureCommands' });
    } else if (e.which === 1) {
      unsuspendTab();
    }
  }

  function unsuspendTab(addToTemporaryWhitelist) {
    if (tabId) {
      try {
        if (addToTemporaryWhitelist) {
          chrome.extension
            .getBackgroundPage()
            .tgs.setTabFlagForTabId(
              tabId,
              chrome.extension.getBackgroundPage().tgs.TEMP_WHITELIST_ON_RELOAD,
              true
            );
        }
        if (scrollPosition) {
          chrome.extension
            .getBackgroundPage()
            .tgs.setTabFlagForTabId(
              tabId,
              chrome.extension.getBackgroundPage().tgs.SCROLL_POS,
              scrollPosition
            );
        }
      } catch (error) {
        console.error(error);
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
    document.getElementById('bitcoinBtn').onclick = function() {
      try {
        chrome.extension
          .getBackgroundPage()
          .gsAnalytics.reportEvent('Donations', 'Click', 'coinbase');
      } catch (error) {
        console.error(error);
      }
    };
    document.getElementById('patreonBtn').onclick = function() {
      try {
        chrome.extension
          .getBackgroundPage()
          .gsAnalytics.reportEvent('Donations', 'Click', 'patreon');
      } catch (error) {
        console.error(error);
      }
    };
    document.getElementById('paypalBtn').onclick = function() {
      try {
        chrome.extension
          .getBackgroundPage()
          .gsAnalytics.reportEvent('Donations', 'Click', 'paypal');
      } catch (error) {
        console.error(error);
      }
    };
  }

  function loadDonationPopupTemplate() {
    showingNag = true;

    var popupEl = document.createElement('div');
    popupEl.innerHTML = document.getElementById('donateTemplate').innerHTML;
    localiseHtml(popupEl);
    document.getElementsByTagName('body')[0].appendChild(popupEl);

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

  function getFaviconMetaData(url, callback) {
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
      if (maxRgb === 0) {
        getFaviconMetaData(DEFAULT_FAVICON, callback);
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

      callback({
        isDark,
        normalisedDataUrl,
        transparentDataUrl,
      });
    };
    img.src = url || DEFAULT_FAVICON;
  }

  function documentReadyAsPromsied() {
    return new Promise(function(resolve, reject) {
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
    Array.prototype.forEach.call(parentEl.getElementsByTagName('*'), function(
      el
    ) {
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
    chrome.runtime.onMessage.addListener(function(
      request,
      sender,
      sendResponse
    ) {
      switch (request.action) {
        case 'initSuspendedTab':
          handleInitRequest(request);
          isInitialised = true;
          break;

        case 'updateSuspendedTab':
          handleInitRequest(request);
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
      return false;
    });
  }

  function buildReportTabStatePayload() {
    return {
      isInitialised,
      tabId,
      requestUnsuspendOnReload,
    };
  }

  function handleInitRequest(request) {
    if (request.tabId && !tabId) {
      init(request.tabId);
    }
    if (request.hasOwnProperty('requestUnsuspendOnReload')) {
      requestUnsuspendOnReload = request.requestUnsuspendOnReload;
    }
    if (request.hasOwnProperty('scrollPosition')) {
      scrollPosition = request.scrollPosition;
    }
    if (request.hasOwnProperty('previewUri')) {
      previewUri = request.previewUri;
    }
    if (request.hasOwnProperty('previewMode')) {
      setPreviewMode(request.previewMode);
    }
    if (request.hasOwnProperty('theme')) {
      setTheme(request.theme);
    }
    if (request.hasOwnProperty('hideNag')) {
      handleDonationPopup(request.hideNag);
    }
    if (request.hasOwnProperty('command')) {
      setCommand(request.command);
    }
    if (request.hasOwnProperty('favicon')) {
      setFavicon(request.favicon);
    }
    if (request.hasOwnProperty('title')) {
      setTitle(request.title);
    }
    if (request.hasOwnProperty('url')) {
      setUrl(request.url);
    }
  }

  documentReadyAsPromsied().then(function() {
    localiseHtml(document);
    preInit();
    addMessageListeners();
  });
})();
