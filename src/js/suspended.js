/*global window, document, chrome, Image, XMLHttpRequest */
(function() {
  'use strict';

  var gsUtils;
  var gsAnalytics;
  var gsStorage;
  var requestUnsuspendOnReload = false;

  backgroundPageReadyAsPromsied()
    .then(function() {
      gsUtils = chrome.extension.getBackgroundPage().gsUtils;
      gsAnalytics = chrome.extension.getBackgroundPage().gsAnalytics;
      gsStorage = chrome.extension.getBackgroundPage().gsStorage;

      gsUtils
        .documentReadyAndLocalisedAsPromsied(document)
        .then(function(domLoadedEvent) {
          var url = gsUtils.getSuspendedUrl(window.location.href);
          return gsStorage.fetchTabInfo(url);
        })
        .then(function(tabProperties) {
          init(tabProperties);
        });
    })
    .catch(function(err) {
      console.error(err);
      documentReadyAsPromsied().then(fallbackInit);
    });

  function fallbackInit() {
    var href = window.location.href;
    var titleRegex = /ttl=([^&]*)/;
    var urlRegex = /uri=(.*)/;
    var preTitle = href.match(titleRegex) ? href.match(titleRegex)[1] : null;
    var preUrl = href.match(urlRegex) ? href.match(urlRegex)[1] : null;
    if (preTitle) {
      preTitle = decodeURIComponent(preTitle);
      document.getElementById('gsTitle').innerHTML = decodeURIComponent(
        preTitle
      );
      document.getElementById('gsTopBarTitle').innerHTML = preTitle;
      document.getElementById('gsTopBarTitle').setAttribute('title', preTitle);
    }
    if (preUrl) {
      preUrl = decodeURIComponent(preUrl);
      var faviconUrl = 'chrome://favicon/' + preUrl;
      document.getElementById('gsFavicon').setAttribute('href', faviconUrl);
      document.getElementById('gsTopBarImg').setAttribute('src', faviconUrl);
      document.getElementById('gsTopBarTitle').setAttribute('href', preUrl);
      document.getElementById('suspendedMsg').onclick = function() {
        window.location.replace(preUrl);
      };
      document.getElementById('gsReloadLink').onclick = function() {
        window.location.replace(preUrl);
      };
    }
    document
      .getElementById('suspendedMsg')
      .getElementsByTagName('h1')[0].innerHTML =
      'Tab suspended';
    document
      .getElementById('suspendedMsg')
      .getElementsByTagName('h2')[0].innerHTML =
      'Refresh or click to reload';
    document.getElementById('gsReloadLink').innerHTML = 'Reload tab';
    document.getElementById('gsReloadLink').nextElementSibling.innerHTML = '';
  }

  function init(tabProperties) {
    var url = gsUtils.getSuspendedUrl(window.location.href);

    //if we are missing some suspend information for this tab
    if (!tabProperties) {
      tabProperties = {
        url: url,
        favicon: 'chrome://favicon/' + url
      };
    }

    var rootUrlStr = gsUtils.getRootUrl(url),
      fullUrlStr = gsUtils.getRootUrl(url, true),
      scrollPos = gsUtils.getSuspendedScrollPosition(window.location.href),
      showPreview = gsStorage.getOption(gsStorage.SCREEN_CAPTURE) !== '0',
      scrollImagePreview =
        gsStorage.getOption(gsStorage.SCREEN_CAPTURE) === '2';

    var title = tabProperties ? tabProperties.title : '';
    var placeholderTitle = chrome.i18n.getMessage('html_suspended_title');
    if (!title || title === placeholderTitle) {
      title = gsUtils.getSuspendedTitle(window.location.href);
    }
    if (!title || title === placeholderTitle) {
      title = rootUrlStr;
    } else if (title.indexOf('<') >= 0) {
      // Encode any raw html tags that might be used in the title
      title = gsUtils.htmlEncode(title);
    }

    //set favicon
    var favicon = tabProperties.favicon;
    generateFaviconUri(favicon, function(faviconUrl) {
      setFavicon(faviconUrl);
    });

    //set theme
    if (gsStorage.getOption(gsStorage.THEME) === 'dark') {
      var body = document.querySelector('body');
      body.className += ' dark';
    }

    //set preview image
    if (showPreview) {
      gsStorage.fetchPreviewImage(url, function(preview) {
        if (
          preview &&
          preview.img &&
          preview.img !== null &&
          preview.img !== 'data:,' &&
          preview.img.length > 10000
        ) {
          var previewEl = document.createElement('div');
          previewEl.innerHTML = document.getElementById(
            'previewTemplate'
          ).innerHTML;
          gsUtils.localiseHtml(previewEl);
          previewEl.onclick = handleUnsuspendTab;
          document.getElementsByTagName('body')[0].appendChild(previewEl);

          document
            .getElementById('gsPreviewImg')
            .setAttribute('src', preview.img);
          if (scrollImagePreview) {
            document
              .getElementById('gsPreviewImg')
              .addEventListener(
                'load',
                function() {
                  document.body.scrollTop = scrollPos || 0;
                },
                { once: true }
              );
          }
          document.getElementById('suspendedMsg').style.display = 'none';
          previewEl.style.display = 'block';

          //allow vertical scrollbar if we are using high quality previews
          if (gsStorage.getOption(gsStorage.SCREEN_CAPTURE) === '2') {
            document.body.style['overflow-x'] = 'auto';
          }
        } else {
          document.getElementById('suspendedMsg').style.display = 'table-cell';
        }
      });
    } else {
      document.getElementById('suspendedMsg').style.display = 'table-cell';
    }

    //populate suspended tab bar
    document.getElementById('gsTitle').innerHTML = title;
    document.getElementById('gsTopBarTitle').innerHTML = title;
    document.getElementById('gsTopBarTitle').setAttribute('title', url);
    document.getElementById('gsTopBarTitle').setAttribute('href', url);
    document.getElementById('gsTopBarImg').setAttribute('src', favicon);

    //update hotkey
    chrome.commands.getAll(function(commands) {
      var hotkeyEl = document.getElementById('hotkeyCommand');
      if (!hotkeyEl) {
        return;
      }
      var toggleCommand = commands.find(function(command) {
        return command.name === '1-suspend-tab';
      });
      if (hotkeyEl && toggleCommand && toggleCommand.shortcut !== '') {
        hotkeyEl.innerHTML = toggleCommand.shortcut;
      } else {
        var shortcutNotSetEl = document.createElement('a');
        shortcutNotSetEl.innerHTML = chrome.i18n.getMessage(
          'js_shortcuts_not_set'
        );
        hotkeyEl.appendChild(shortcutNotSetEl);
        hotkeyEl.onclick = function(e) {
          e.stopPropagation();
          chrome.tabs.create({ url: 'chrome://extensions/configureCommands' });
        };
      }
    });

    //update whitelist text
    var isWhitelisted = gsUtils.checkWhiteList(url);
    if (isWhitelisted) {
      document.getElementById(
        'gsWhitelistLink'
      ).innerHTML = chrome.i18n.getMessage(
        'js_suspended_remove_from_whitelist'
      );

      //populate modal
    } else {
      document.getElementById('rootUrl').innerHTML = rootUrlStr;
      document.getElementById('fullUrl').innerHTML = fullUrlStr;
      //whitelistPageEl.innerHTML = fullUrlStr;
    }

    //click listeners
    document.getElementById('suspendedMsg').onclick = handleUnsuspendTab;
    document.getElementById('gsReloadLink').onclick = handleUnsuspendTab;
    document.getElementById('gsTopBarTitle').onclick = handleUnsuspendTab;
    document.getElementById('gsWhitelistLink').onclick = function() {
      if (isWhitelisted) {
        unwhitelistTab(rootUrlStr, fullUrlStr);
      } else {
        // hide second option (whitelist page) if the url is the same as the root url
        if (rootUrlStr === fullUrlStr) {
          document.getElementById('whitelistPage').parentElement.style.display =
            'none';
        }
        toggleModal(true);
      }
    };
    document.getElementById('confirmWhitelistBtn').onclick = function() {
      if (document.getElementById('whitelistSite').checked && rootUrlStr) {
        whitelistTab(rootUrlStr);
      } else if (
        document.getElementById('whitelistPage').checked &&
        fullUrlStr
      ) {
        whitelistTab(fullUrlStr);
      } else {
        temporarilyWhitelistTab();
      }
    };

    Array.from(document.querySelectorAll('.close')).forEach(function(link) {
      link.addEventListener('click', function(event) {
        toggleModal(false);
      });
    });

    // When the user clicks anywhere outside of the modal, close it
    window.onclick = function(event) {
      if (event.target === document.getElementById('whitelistOptionsModal')) {
        toggleModal(false);
      }
    };

    //show dude and donate link (randomly 1 of 33 times)
    if (!gsStorage.getOption(gsStorage.NO_NAG) && Math.random() > 0.97) {
      window.addEventListener('focus', displayPopup);
    }

    //add an unload listener to tell the page to unsuspend on refresh
    //this will fail if tab is being closed but if page is refreshed it will trigger an unsuspend
    window.addEventListener('beforeunload', function(event) {
      if (requestUnsuspendOnReload) {
        chrome.runtime.sendMessage({ action: 'requestUnsuspendOnReload' });
      }
    });

    var payload = {
      action: 'reportTabState',
      status: 'suspended'
    };
    chrome.runtime.sendMessage(payload);
  }

  function generateFaviconUri(url, callback) {
    var img = new Image();

    img.onload = function() {
      var canvas, context;
      canvas = window.document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      context = canvas.getContext('2d');
      context.globalAlpha = 0.5;
      context.drawImage(img, 0, 0);

      callback(canvas.toDataURL());
    };
    img.src = url || chrome.extension.getURL('img/default.ico');
  }

  function setFavicon(favicon) {
    document.getElementById('gsFavicon').setAttribute('href', favicon);
  }

  function handleUnsuspendTab(e) {
    // dont want to pass the event arg along to the requestUnsuspendTab function!!
    e.preventDefault();
    requestUnsuspendTab();
  }

  function requestUnsuspendTab(addToTemporaryWhitelist) {
    var payload = {
      action: 'requestUnsuspendTab',
      addToTemporaryWhitelist: addToTemporaryWhitelist
    };
    chrome.runtime.sendMessage(payload, function(response) {
      if (chrome.runtime.lastError) {
        gsUtils.error(
          '-> Suspended tab: Error requesting unsuspendTab. Will unsuspend locally.',
          chrome.runtime.lastError
        );
        unsuspendTab();
      }
    });
  }

  function unsuspendTab() {
    var url = gsUtils.getSuspendedUrl(window.location.href);
    if (url) {
      document.getElementById('suspendedMsg').innerHTML = '';
      document.getElementById('refreshSpinner').classList.add('spinner');
      window.location.replace(url);
    }
  }

  function whitelistTab(whitelistString) {
    gsUtils.saveToWhitelist(whitelistString);
    toggleModal(false);
    requestUnsuspendTab();
  }

  function unwhitelistTab(rootUrlStr, fullUrlStr) {
    gsUtils.removeFromWhitelist(rootUrlStr);
    gsUtils.removeFromWhitelist(fullUrlStr);
    toggleModal(false);
    requestUnsuspendTab();
  }

  function temporarilyWhitelistTab() {
    toggleModal(false);
    requestUnsuspendTab(true);
  }

  function showNoConnectivityMessage() {
    document.getElementById('disconnectedNotice').style.display = 'none';
    setTimeout(function() {
      document.getElementById('disconnectedNotice').style.display = 'block';
    }, 50);
  }

  function toggleModal(visible) {
    document.getElementById('whitelistOptionsModal').style.display = visible
      ? 'block'
      : 'none';
  }

  function loadDonateButtons() {
    document.getElementById('donateButtons').innerHTML = this.responseText;

    document.getElementById('bitcoinBtn').innerHTML = chrome.i18n.getMessage(
      'js_donate_bitcoin'
    );
    document.getElementById('bitcoinBtn').onclick = function() {
      gsAnalytics.reportEvent('Donations', 'Click', 'bitcoin');
    };

    document
      .getElementById('paypalBtn')
      .setAttribute('value', chrome.i18n.getMessage('js_donate_paypal'));
    document.getElementById('paypalBtn').onclick = function() {
      gsAnalytics.reportEvent('Donations', 'Click', 'paypal');
    };
  }

  function displayPopup(e) {
    e.target.removeEventListener('focus', displayPopup);
    //if user has donated since this page was first generated then dont display popup
    if (gsStorage.getOption(gsStorage.NO_NAG)) {
      return;
    }

    //generate html for popupDude
    var popupEl = document.createElement('div');
    popupEl.innerHTML = document.getElementById('donateTemplate').innerHTML;
    gsUtils.localiseHtml(popupEl);
    document.getElementsByTagName('body')[0].appendChild(popupEl);

    var request = new XMLHttpRequest();
    request.onload = loadDonateButtons;
    request.open('GET', 'support.html', true);
    request.send();

    document.getElementById('dudePopup').setAttribute('class', 'poppedup');
    document.getElementById('donateBubble').setAttribute('class', 'fadeIn');
  }

  function backgroundPageReadyAsPromsied() {
    return new Promise(function(resolve, reject) {
      if (chrome.extension.getBackgroundPage()) {
        resolve();
      } else {
        console.log('Background page not ready. Waiting 500ms..');
        window.setTimeout(function() {
          if (chrome.extension.getBackgroundPage()) {
            resolve();
          } else {
            reject(new Error('Background page could not be initialised!'));
          }
        }, 500);
      }
    });
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

  //listen for background events
  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    switch (request.action) {
      case 'unsuspendTab':
        unsuspendTab();
        sendResponse({ result: 'done' });
        return false;

      case 'setUnsuspendOnReload':
        requestUnsuspendOnReload = request.value || false;
        sendResponse({ result: 'done' });
        return false;

      case 'showNoConnectivityMessage':
        showNoConnectivityMessage();
        sendResponse({ result: 'done' });
        return false;
    }
  });
})();
