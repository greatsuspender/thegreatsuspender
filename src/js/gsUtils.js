/*global chrome, localStorage, gsStorage, gsMessages, gsSession, gsSuspendManager, gsAnalytics, tgs */
'use strict';

var debugInfo = false;
var debugError = false;

var gsUtils = {
  STATUS_NORMAL: 'normal',
  STATUS_LOADING: 'loading',
  STATUS_SPECIAL: 'special',
  STATUS_SUSPENDED: 'suspended',
  STATUS_DISCARDED: 'discarded',
  STATUS_NEVER: 'never',
  STATUS_FORMINPUT: 'formInput',
  STATUS_AUDIBLE: 'audible',
  STATUS_ACTIVE: 'active',
  STATUS_TEMPWHITELIST: 'tempWhitelist',
  STATUS_PINNED: 'pinned',
  STATUS_WHITELISTED: 'whitelisted',
  STATUS_CHARGING: 'charging',
  STATUS_NOCONNECTIVITY: 'noConnectivity',
  STATUS_UNKNOWN: 'unknown',

  // eslint-disable-line no-unused-vars
  contains: function(array, value) {
    for (var i = 0; i < array.length; i++) {
      if (array[i] === value) return true;
    }
    return false;
  },

  log: function(id, text, ...args) {
    if (debugInfo) {
      args = args || [];
      console.log(id, (new Date() + '').split(' ')[4], text, ...args);
    }
  },
  debug: function(id, text, ...args) {
    args = args || [];
    const stackStrings = gsUtils.getStackTrace().split('\n');
    const stackString = (
      stackStrings[3] ||
      stackStrings[2] ||
      stackStrings[1]
    ).replace(/.*\/(.*):.*/, '$1');
    console.log(
      id,
      (new Date() + '').split(' ')[4],
      text,
      ...args,
      ' -> ',
      stackString
    );
  },
  error: function(id, errorObj, ...args) {
    if (debugError) {
      args = args || [];
      console.error(id, (new Date() + '').split(' ')[4], errorObj, ...args);
    } else {
      // var logString = errorObj.hasOwnProperty('stack')
      //   ? errorObj.stack
      //   : `${JSON.stringify(errorObj)}\n${this.getStackTrace()}`;
      // gsAnalytics.reportException(logString, false);
    }
  },
  errorIfInitialised: function(id, text, ...args) {
    if (!debugError) {
      return;
    }
    args = args || [];
    if (gsSession.isInitialising()) {
      console.log(id, (new Date() + '').split(' ')[4], text, ...args);
    } else {
      console.error(id, (new Date() + '').split(' ')[4], text, ...args);
    }
  },
  dir: function(object) {
    if (debugInfo) {
      console.dir(object);
    }
  },
  getStackTrace: function() {
    var obj = {};
    Error.captureStackTrace(obj, gsUtils.getStackTrace);
    return obj.stack;
  },

  isDebugInfo: function() {
    return debugInfo;
  },

  isDebugError: function() {
    return debugError;
  },

  setDebugInfo: function(value) {
    debugInfo = value;
  },

  setDebugError: function(value) {
    debugError = value;
  },

  isDiscardedTab: function(tab) {
    return tab.discarded;
  },

  //tests for non-standard web pages. does not check for suspended pages!
  isSpecialTab: function(tab) {
    var url = tab.url;

    if (this.isSuspendedUrl(url, false)) {
      return false;
    }
    // Careful, suspended urls start with "chrome-extension://"
    if (
      url.indexOf('about') === 0 ||
      url.indexOf('chrome') === 0 ||
      url.indexOf('file') === 0 ||
      url.indexOf('chrome.google.com/webstore') >= 0
    ) {
      return true;
    }
    return false;
  },

  //does not include suspended pages!
  isInternalTab: function(tab) {
    var isLocalExtensionPage =
      tab.url.indexOf('chrome-extension://' + chrome.runtime.id) === 0;
    return isLocalExtensionPage && !gsUtils.isSuspendedUrl(tab.url, true);
  },

  isProtectedPinnedTab: function(tab) {
    var dontSuspendPinned = gsStorage.getOption(gsStorage.IGNORE_PINNED);
    return dontSuspendPinned && tab.pinned;
  },

  isProtectedAudibleTab: function(tab) {
    var dontSuspendAudible = gsStorage.getOption(gsStorage.IGNORE_AUDIO);
    return dontSuspendAudible && tab.audible;
  },

  isProtectedActiveTab: function(tab) {
    var dontSuspendActiveTabs = gsStorage.getOption(
      gsStorage.IGNORE_ACTIVE_TABS
    );
    return (
      tgs.isCurrentFocusedTab(tab) || (dontSuspendActiveTabs && tab.active)
    );
  },

  isNormalTab: function(tab) {
    return !gsUtils.isSpecialTab(tab) && !gsUtils.isSuspendedTab(tab);
  },

  isSuspendedTab: function(tab, strictMatching) {
    return this.isSuspendedUrl(tab.url, strictMatching);
  },

  isSuspendedUrl: function(url, strictMatching) {
    if (strictMatching) {
      return url.indexOf(chrome.extension.getURL('suspended.html')) === 0;
    } else {
      return url.indexOf('suspended.html') > 0;
    }
  },

  removeTabsByUrlAsPromised: function(url) {
    return new Promise(resolve => {
      chrome.tabs.query({ url }, function(tabs) {
        chrome.tabs.remove(
          tabs.map(function(tab) {
            return tab.id;
          })
        );
        resolve();
      });
    });
  },

  checkWhiteList: function(url) {
    return gsUtils.checkSpecificWhiteList(
      url,
      gsStorage.getOption(gsStorage.WHITELIST)
    );
  },

  checkSpecificWhiteList: function(url, whitelistString) {
    var whitelistItems = whitelistString
        ? whitelistString.split(/[\s\n]+/)
        : [],
      whitelisted;

    whitelisted = whitelistItems.some(function(item) {
      return this.testForMatch(item, url);
    }, this);
    return whitelisted;
  },

  removeFromWhitelist: function(url) {
    var oldWhitelistString = gsStorage.getOption(gsStorage.WHITELIST) || '',
      whitelistItems = oldWhitelistString.split(/[\s\n]+/).sort(),
      i;

    for (i = whitelistItems.length - 1; i >= 0; i--) {
      if (this.testForMatch(whitelistItems[i], url)) {
        whitelistItems.splice(i, 1);
      }
    }
    var whitelistString = whitelistItems.join('\n');
    gsStorage.setOption(gsStorage.WHITELIST, whitelistString);
    gsStorage.syncSettings();

    var key = gsStorage.WHITELIST;
    gsUtils.performPostSaveUpdates(
      [key],
      { [key]: oldWhitelistString },
      { [key]: whitelistString }
    );
  },

  testForMatch: function(whitelistItem, word) {
    if (whitelistItem.length < 1) {
      return false;

      //test for regex ( must be of the form /foobar/ )
    } else if (
      whitelistItem.length > 2 &&
      whitelistItem.indexOf('/') === 0 &&
      whitelistItem.indexOf('/', whitelistItem.length - 1) !== -1
    ) {
      whitelistItem = whitelistItem.substring(1, whitelistItem.length - 1);
      try {
        new RegExp(whitelistItem); // eslint-disable-line no-new
      } catch (e) {
        return false;
      }
      return new RegExp(whitelistItem).test(word);

      // test as substring
    } else {
      return word.indexOf(whitelistItem) >= 0;
    }
  },

  saveToWhitelist: function(newString) {
    var oldWhitelistString = gsStorage.getOption(gsStorage.WHITELIST) || '';
    var newWhitelistString = oldWhitelistString + '\n' + newString;
    newWhitelistString = this.cleanupWhitelist(newWhitelistString);
    gsStorage.setOption(gsStorage.WHITELIST, newWhitelistString);
    gsStorage.syncSettings();

    var key = gsStorage.WHITELIST;
    gsUtils.performPostSaveUpdates(
      [key],
      { [key]: oldWhitelistString },
      { [key]: newWhitelistString }
    );
  },

  cleanupWhitelist: function(whitelist) {
    var whitelistItems = whitelist ? whitelist.split(/[\s\n]+/).sort() : '',
      i,
      j;

    for (i = whitelistItems.length - 1; i >= 0; i--) {
      j = whitelistItems.lastIndexOf(whitelistItems[i]);
      if (j !== i) {
        whitelistItems.splice(i + 1, j - i);
      }
      if (!whitelistItems[i] || whitelistItems[i] === '') {
        whitelistItems.splice(i, 1);
      }
    }
    if (whitelistItems.length) {
      return whitelistItems.join('\n');
    } else {
      return whitelistItems;
    }
  },

  documentReadyAsPromsied: function(doc) {
    return new Promise(function(resolve, reject) {
      if (doc.readyState !== 'loading') {
        resolve();
      } else {
        doc.addEventListener('DOMContentLoaded', function() {
          resolve();
        });
      }
    });
  },

  localiseHtml: function(parentEl) {
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
  },

  documentReadyAndLocalisedAsPromsied: function(doc) {
    var self = this;
    return self.documentReadyAsPromsied(doc).then(function() {
      return self.localiseHtml(doc);
    });
  },

  generateSuspendedUrl: function(url, title, scrollPos) {
    var args =
      '#' +
      'ttl=' +
      encodeURIComponent(title) +
      '&' +
      'pos=' +
      (scrollPos || '0') +
      '&' +
      'uri=' +
      url;

    return chrome.extension.getURL('suspended.html' + args);
  },

  getRootUrl: function(url, includePath) {
    let rootUrlStr = url;

    // remove scheme
    if (rootUrlStr.indexOf('//') > 0) {
      rootUrlStr = rootUrlStr.substring(rootUrlStr.indexOf('//') + 2);
    }

    // remove path
    if (!includePath) {
      rootUrlStr = rootUrlStr.substring(0, rootUrlStr.indexOf('/'));
    } else {
      // remove query string
      var match = rootUrlStr.match(/\/?[?#]+/);
      if (match) {
        rootUrlStr = rootUrlStr.substring(0, match.index);
      }
      // remove trailing slash
      match = rootUrlStr.match(/\/$/);
      if (match) {
        rootUrlStr = rootUrlStr.substring(0, match.index);
      }
    }
    return rootUrlStr;
  },

  getHashVariable: function(key, urlStr) {
    var valuesByKey = {},
      keyPairRegEx = /^(.+)=(.+)/,
      hashStr;

    if (!urlStr || urlStr.length === 0 || urlStr.indexOf('#') === -1) {
      return false;
    }

    //extract hash component from url
    hashStr = urlStr.replace(/^[^#]+#+(.*)/, '$1');

    if (hashStr.length === 0) {
      return false;
    }

    //handle possible unencoded final var called 'uri'
    let uriIndex = hashStr.indexOf('uri=');
    if (uriIndex >= 0) {
      valuesByKey.uri = hashStr.substr(uriIndex + 4);
      hashStr = hashStr.substr(0, uriIndex);
    }

    hashStr.split('&').forEach(function(keyPair) {
      if (keyPair && keyPair.match(keyPairRegEx)) {
        valuesByKey[keyPair.replace(keyPairRegEx, '$1')] = keyPair.replace(
          keyPairRegEx,
          '$2'
        );
      }
    });
    return valuesByKey[key] || false;
  },
  getSuspendedTitle: function(urlStr) {
    return decodeURIComponent(this.getHashVariable('ttl', urlStr) || '');
  },
  getSuspendedScrollPosition: function(urlStr) {
    return decodeURIComponent(this.getHashVariable('pos', urlStr) || '');
  },
  getSuspendedUrl: function(urlStr) {
    return (
      this.getHashVariable('uri', urlStr) ||
      decodeURIComponent(this.getHashVariable('url', urlStr) || '')
    );
  },

  getSuspendedTabCount: function() {
    var suspendedTabCount = 0;
    var self = this;
    chrome.extension.getViews({ type: 'tab' }).forEach(function(window) {
      if (self.isSuspendedUrl(window.location.href, true)) {
        suspendedTabCount++;
      }
    });
    return suspendedTabCount;
  },

  htmlEncode: function(text) {
    return document
      .createElement('pre')
      .appendChild(document.createTextNode(text)).parentNode.innerHTML;
  },

  getChromeVersion: function() {
    var raw = navigator.userAgent.match(/Chrom(e|ium)\/([0-9]+)\./);
    return raw ? parseInt(raw[2], 10) : false;
  },

  generateHashCode: function(text) {
    var hash = 0,
      i,
      chr,
      len;
    if (!text) return hash;
    for (i = 0, len = text.length; i < len; i++) {
      chr = text.charCodeAt(i);
      hash = (hash << 5) - hash + chr;
      hash |= 0; // Convert to 32bit integer
    }
    return Math.abs(hash);
  },

  buildSuspendUnsuspendHotkey: function(callback) {
    var printableHotkey = '';
    chrome.commands.getAll(function(commands) {
      var toggleCommand = commands.find(function(command) {
        return command.name === '1-suspend-tab';
      });
      if (toggleCommand && toggleCommand.shortcut !== '') {
        printableHotkey = toggleCommand.shortcut
          .replace(/Command/, '\u2318')
          .replace(/Shift/, '\u21E7')
          .replace(/Control/, '^')
          .replace(/\+/g, ' ');
        callback(printableHotkey);
      } else {
        callback(null);
      }
    });
  },

  getAllExpiredTabs: function(callback) {
    var expiredTabs = [];
    var checkTabExpiryPromises = [];
    chrome.tabs.query({}, function(tabs) {
      tabs.forEach(function(currentTab) {
        if (
          gsUtils.isNormalTab(currentTab) &&
          !gsUtils.isDiscardedTab(currentTab)
        ) {
          checkTabExpiryPromises.push(
            new Promise(function(resolve) {
              gsMessages.sendRequestInfoToContentScript(currentTab.id, function(
                err,
                tabInfo
              ) {
                if (
                  tabInfo &&
                  tabInfo.timerUp &&
                  new Date(tabInfo.timerUp) < new Date()
                ) {
                  expiredTabs.push(currentTab);
                }
                resolve();
              });
            })
          );
        }
      });
      Promise.all(checkTabExpiryPromises).then(function() {
        callback(expiredTabs);
      });
    });
  },

  performPostSaveUpdates: function(
    changedSettingKeys,
    oldValueBySettingKey,
    newValueBySettingKey
  ) {
    chrome.tabs.query({}, function(tabs) {
      tabs.forEach(function(tab) {
        if (gsUtils.isSpecialTab(tab)) {
          return;
        }

        if (gsUtils.isSuspendedTab(tab)) {
          //If toggling IGNORE_PINNED or IGNORE_ACTIVE_TABS to TRUE, then unsuspend any suspended pinned/active tabs
          if (
            (changedSettingKeys.includes(gsStorage.IGNORE_PINNED) &&
              gsUtils.isProtectedPinnedTab(tab)) ||
            (changedSettingKeys.includes(gsStorage.IGNORE_ACTIVE_TABS) &&
              gsUtils.isProtectedActiveTab(tab))
          ) {
            tgs.unsuspendTab(tab);
            return;
          }

          //if theme or screenshot preferences have changed then refresh suspended tabs
          var payload = {};
          if (changedSettingKeys.includes(gsStorage.THEME)) {
            payload.theme = gsStorage.getOption(gsStorage.THEME);
          }
          if (changedSettingKeys.includes(gsStorage.SCREEN_CAPTURE)) {
            payload.previewMode = gsStorage.getOption(gsStorage.SCREEN_CAPTURE);
          }
          if (Object.keys(payload).length > 0) {
            gsMessages.sendUpdateSuspendedTab(tab.id, payload);
          }
          return;
        }

        if (gsUtils.isDiscardedTab(tab)) {
          //if discarding strategy has changed then updated discarded and suspended tabs
          if (
            changedSettingKeys.includes(gsStorage.SUSPEND_IN_PLACE_OF_DISCARD)
          ) {
            var suspendInPlaceOfDiscard = gsStorage.getOption(
              gsStorage.SUSPEND_IN_PLACE_OF_DISCARD
            );
            if (suspendInPlaceOfDiscard) {
              var suspendedUrl = gsUtils.generateSuspendedUrl(
                tab.url,
                tab.title,
                0
              );
              gsSuspendManager.forceTabSuspension(tab, suspendedUrl);
            }
          }
          return;
        }

        //update content scripts of normal tabs
        let updateIgnoreForms = changedSettingKeys.includes(
          gsStorage.IGNORE_FORMS
        );
        let updateSuspendTime =
          changedSettingKeys.includes(gsStorage.SUSPEND_TIME) ||
          (changedSettingKeys.includes(gsStorage.IGNORE_ACTIVE_TABS) &&
            tab.active) ||
          (changedSettingKeys.includes(gsStorage.IGNORE_PINNED) &&
            !gsStorage.getOption(gsStorage.IGNORE_PINNED) &&
            tab.pinned) ||
          (changedSettingKeys.includes(gsStorage.IGNORE_AUDIO) &&
            !gsStorage.getOption(gsStorage.IGNORE_AUDIO) &&
            tab.audible) ||
          (changedSettingKeys.includes(gsStorage.IGNORE_WHEN_OFFLINE) &&
            !gsStorage.getOption(gsStorage.IGNORE_WHEN_OFFLINE) &&
            !navigator.onLine) ||
          (changedSettingKeys.includes(gsStorage.IGNORE_WHEN_CHARGING) &&
            !gsStorage.getOption(gsStorage.IGNORE_WHEN_CHARGING) &&
            tgs.isCharging()) ||
          (changedSettingKeys.includes(gsStorage.WHITELIST) &&
            (gsUtils.checkSpecificWhiteList(
              tab.url,
              oldValueBySettingKey[gsStorage.WHITELIST]
            ) &&
              !gsUtils.checkSpecificWhiteList(
                tab.url,
                newValueBySettingKey[gsStorage.WHITELIST]
              )));

        if (updateSuspendTime || updateIgnoreForms) {
          gsMessages.sendUpdateToContentScriptOfTab(
            tab,
            updateSuspendTime,
            updateIgnoreForms
          );
        }

        //if we aren't resetting the timer on this tab, then check to make sure it does not have an expired timer
        //should always be caught by tests above, but we'll check all tabs anyway just in case
        // if (!updateSuspendTime) {
        //     gsMessages.sendRequestInfoToContentScript(tab.id, function (err, tabInfo) {
        //         tgs.calculateTabStatus(tab, tabInfo, function (tabStatus) {
        //             if (tabStatus === STATUS_NORMAL && tabInfo && tabInfo.timerUp && (new Date(tabInfo.timerUp)) < new Date()) {
        //                 gsUtils.error(tab.id, 'Tab has an expired timer!', tabInfo);
        //                 gsMessages.sendUpdateToContentScriptOfTab(tab, true, false);
        //             }
        //         });
        //     });
        // }
      });
    });

    //if context menu has been disabled then remove from chrome
    if (this.contains(changedSettingKeys, gsStorage.ADD_CONTEXT)) {
      var addContextMenu = gsStorage.getOption(gsStorage.ADD_CONTEXT);
      tgs.buildContextMenu(addContextMenu);
    }

    //if screenshot preferences have changed then update the queue parameters
    if (
      this.contains(changedSettingKeys, gsStorage.SCREEN_CAPTURE) ||
      this.contains(changedSettingKeys, gsStorage.SCREEN_CAPTURE_FORCE)
    ) {
      gsSuspendManager.init();
    }
  },

  getWindowFromSession: function(windowId, session) {
    var window = false;
    session.windows.some(function(curWindow) {
      //leave this as a loose matching as sometimes it is comparing strings. other times ints
      if (curWindow.id == windowId) {
        // eslint-disable-line eqeqeq
        window = curWindow;
        return true;
      }
    });
    return window;
  },

  saveWindowsToSessionHistory: function(sessionId, windowsArray) {
    var session = {
      sessionId: sessionId,
      windows: windowsArray,
      date: new Date().toISOString(),
    };
    gsStorage.updateSession(session);
  },

  removeInternalUrlsFromSession: function(session) {
    if (!session || !session.windows) {
      return;
    }
    for (var i = session.windows.length - 1; i >= 0; i--) {
      var curWindow = session.windows[i];
      for (var j = curWindow.tabs.length - 1; j >= 0; j--) {
        var curTab = curWindow.tabs[j];
        if (gsUtils.isInternalTab(curTab)) {
          curWindow.tabs.splice(j, 1);
        }
      }
      if (curWindow.tabs.length === 0) {
        session.windows.splice(i, 1);
      }
    }
    return session;
  },

  getSimpleDate: function(date) {
    var d = new Date(date);
    return (
      ('0' + d.getDate()).slice(-2) +
      '-' +
      ('0' + (d.getMonth() + 1)).slice(-2) +
      '-' +
      d.getFullYear() +
      ' ' +
      ('0' + d.getHours()).slice(-2) +
      ':' +
      ('0' + d.getMinutes()).slice(-2)
    );
  },

  getHumanDate: function(date) {
    var monthNames = [
        'Jan',
        'Feb',
        'Mar',
        'Apr',
        'May',
        'Jun',
        'Jul',
        'Aug',
        'Sep',
        'Oct',
        'Nov',
        'Dec',
      ],
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
    var hoursString = currentHours % 12 || 12;
    var minutesString = ('0' + currentMinutes).slice(-2);

    return (
      currentDate +
      ' ' +
      monthNames[currentMonth] +
      ' ' +
      currentYear +
      ' ' +
      hoursString +
      ':' +
      minutesString +
      ampm
    );
  },

  debounce: function(func, wait) {
    var timeout;
    return function() {
      var context = this,
        args = arguments;
      var later = function() {
        timeout = null;
        func.apply(context, args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },
};
