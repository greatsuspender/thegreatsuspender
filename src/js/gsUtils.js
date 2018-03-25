/*global chrome, localStorage, gsStorage, gsMessages, gsSession, gsSuspendManager, tgs */
'use strict';

var debugInfo = false;
var debugError = false;

var gsUtils = { // eslint-disable-line no-unused-vars

    contains: function (array, value) {
        for (var i = 0; i < array.length; i++) {
            if (array[i] === value) return true;
        }
        return false;
    },

    log: function (id, text, ...args) {
        if (debugInfo) {
            args = args || [];
            console.log(id, (new Date() + '').split(' ')[4], text, ...args);
        }
    },
    error: function (id, text, ...args) {
        if (debugError) {
            args = args || [];
            console.error(id, (new Date() + '').split(' ')[4], text, ...args);
        }
    },
    errorIfInitialised: function (id, text, ...args) {
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
    dir: function (object) {
        if (debugInfo) {
            console.dir(object);
        }
    },

    isDebugInfo: function () {
        return debugInfo;
    },

    isDebugError: function () {
        return debugError;
    },

    setDebugInfo: function (value) {
        debugInfo = value;
    },

    setDebugError: function (value) {
        debugError = value;
    },

    isDiscardedTab: function (tab) {
        return tab.discarded;
    },

    //tests for non-standard web pages. does not check for suspended pages!
    isSpecialTab: function (tab) {
        var url = tab.url;

        if (this.isSuspendedUrl(url, false)) {
            return false;
        }
        // Careful, suspended urls start with "chrome-extension://"
        if (url.indexOf('about') === 0 ||
            url.indexOf('chrome') === 0 ||
            url.indexOf('file') === 0 ||
            url.indexOf('chrome.google.com/webstore') >= 0) {
            return true;
        }
        return false;
    },

    //does not include suspended pages!
    isInternalTab: function (tab) {
        var isLocalExtensionPage = tab.url.indexOf('chrome-extension://' + chrome.runtime.id) === 0;
        return isLocalExtensionPage && !gsUtils.isSuspendedUrl(tab.url, true);
    },

    isProtectedPinnedTab: function (tab) {
        var dontSuspendPinned = gsStorage.getOption(gsStorage.IGNORE_PINNED);
        return dontSuspendPinned && tab.pinned;
    },

    isProtectedAudibleTab: function (tab) {
        var dontSuspendAudible = gsStorage.getOption(gsStorage.IGNORE_AUDIO);
        return dontSuspendAudible && tab.audible;
    },

    isProtectedActiveTab: function (tab, ignorePref) {
        var dontSuspendActiveTabs = ignorePref ? true : gsStorage.getOption(gsStorage.IGNORE_ACTIVE_TABS);
        return tgs.isCurrentFocusedTab(tab) || (dontSuspendActiveTabs && tab.active);
    },

    isNormalTab: function (tab) {
        return !gsUtils.isSpecialTab(tab) && !gsUtils.isSuspendedTab(tab);
    },

    isSuspendedTab: function (tab, strictMatching) {
        return this.isSuspendedUrl(tab.url, strictMatching);
    },

    isSuspendedUrl: function (url, strictMatching) {
        if (strictMatching) {
            return url.indexOf(chrome.extension.getURL('suspended.html')) === 0;
        } else {
            return url.indexOf('suspended.html') > 0;
        }
    },

    checkWhiteList: function (url) {
        var whitelist = gsStorage.getOption(gsStorage.WHITELIST),
            whitelistItems = whitelist ? whitelist.split(/[\s\n]+/) : [],
            whitelisted;

        whitelisted = whitelistItems.some(function (item) {
            return this.testForMatch(item, url);
        }, this);
        return whitelisted;
    },

    removeFromWhitelist: function (url) {
        var whitelist = gsStorage.getOption(gsStorage.WHITELIST),
            whitelistItems = whitelist ? whitelist.split(/[\s\n]+/).sort() : '',
            i;

        for (i = whitelistItems.length - 1; i >= 0; i--) {
            if (this.testForMatch(whitelistItems[i], url)) {
                whitelistItems.splice(i, 1);
            }
        }
        var whitelistString = whitelistItems.join('\n');
        gsStorage.setOption(gsStorage.WHITELIST, whitelistString);
        gsStorage.syncSettings({ [gsStorage.WHITELIST]: whitelistString });
    },

    testForMatch: function (whitelistItem, word) {

        if (whitelistItem.length < 1) {
            return false;

            //test for regex ( must be of the form /foobar/ )
        } else if (whitelistItem.length > 2 &&
            whitelistItem.indexOf('/') === 0 &&
            whitelistItem.indexOf('/', whitelistItem.length - 1) !== -1) {

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

    saveRootUrlToWhitelist: function (url) {
        let rootUrlStr = url;
        if (rootUrlStr.indexOf('//') > 0) {
            rootUrlStr = rootUrlStr.substring(rootUrlStr.indexOf('//') + 2);
        }
        rootUrlStr = rootUrlStr.substring(0, rootUrlStr.indexOf('/'));
        this.saveToWhitelist(rootUrlStr);
    },

    saveToWhitelist: function (newString) {
        var whitelist = gsStorage.getOption(gsStorage.WHITELIST);
        whitelist = whitelist ? whitelist + '\n' + newString : newString;
        whitelist = this.cleanupWhitelist(whitelist);
        gsStorage.setOption(gsStorage.WHITELIST, whitelist);
        gsStorage.syncSettings({ [gsStorage.WHITELIST]: whitelist });
    },

    cleanupWhitelist: function (whitelist) {
        var whitelistItems = whitelist ? whitelist.split(/[\s\n]+/).sort() : '',
            i,
            j;

        for (i = whitelistItems.length - 1; i >= 0; i--) {
            j = whitelistItems.lastIndexOf(whitelistItems[i]);
            if (j !== i) {
                whitelistItems.splice(i + 1, j - i);
            }
        }
        if (whitelistItems.length) {
            return whitelistItems.join('\n');
        } else {
            return whitelistItems;
        }
    },

    documentReadyAsPromsied: function (doc) {
        return new Promise(function (resolve, reject) {
            if (doc.readyState !== 'loading') {
                resolve();
            } else {
                doc.addEventListener('DOMContentLoaded', function () {
                    resolve();
                });
            }
        });
    },

    localiseHtml: function (parentEl) {
        var replaceFunc = function (match, p1) {
            return p1 ? chrome.i18n.getMessage(p1) : '';
        };
        Array.prototype.forEach.call(parentEl.getElementsByTagName('*'), function (el) {
            if (el.hasAttribute('data-i18n')) {
                el.innerHTML = el.getAttribute('data-i18n').replace(/__MSG_(\w+)__/g, replaceFunc);
            }
            if (el.hasAttribute('data-i18n-tooltip')) {
                el.setAttribute('data-i18n-tooltip', el.getAttribute('data-i18n-tooltip').replace(/__MSG_(\w+)__/g, replaceFunc));
            }
        });
    },

    documentReadyAndLocalisedAsPromsied: function (doc) {
        var self = this;
        return self.documentReadyAsPromsied(doc).then(function () {
            return self.localiseHtml(doc);
        });
    },

    generateSuspendedUrl: function (url, title, scrollPos) {
        var args = '#' +
            'ttl=' + encodeURIComponent(title) + '&' +
            'pos=' + (scrollPos || '0') + '&' +
            'uri=' + (url);

        return chrome.extension.getURL('suspended.html' + args);
    },

    getHashVariable: function (key, urlStr) {

        var valuesByKey = {},
            keyPairRegEx = /^(.+)=(.+)/,
            hashStr;

        //extract hash component from url
        hashStr = urlStr.replace(/^[^#]+#(.*)/, '$1');

        if (hashStr.length === 0) {
            return false;
        }

        //remove possible # prefix
        hashStr = hashStr.replace(/^#(.*)/, '$1');

        //handle possible unencoded final var called 'uri'
        if (hashStr.indexOf('uri=') >= 0) {
            valuesByKey.uri = hashStr.split('uri=')[1];
            hashStr = hashStr.split('uri=')[0];
        }

        hashStr.split('&').forEach(function (keyPair) {
            if (keyPair && keyPair.match(keyPairRegEx)) {
                valuesByKey[keyPair.replace(keyPairRegEx, '$1')] = keyPair.replace(keyPairRegEx, '$2');
            }
        });
        return valuesByKey[key] || false;
    },
    getSuspendedTitle: function (urlStr) {
        return decodeURIComponent(this.getHashVariable('ttl', urlStr) || '');
    },
    getSuspendedScrollPosition: function (urlStr) {
        return decodeURIComponent(this.getHashVariable('pos', urlStr) || '');
    },
    getSuspendedUrl: function (urlStr) {
        return this.getHashVariable('uri', urlStr) || decodeURIComponent(this.getHashVariable('url', urlStr) || '');
    },

    getSuspendedTabCount: function () {
        var suspendedTabCount = 0;
        var self = this;
        chrome.extension.getViews({type: 'tab'}).forEach(function (window) {
            if (self.isSuspendedUrl(window.location.href, true)) {
                suspendedTabCount++;
            }
        });
        return suspendedTabCount;
    },
    isExtensionTabOpen: function (tabName) {
        var tabFound = chrome.extension.getViews({type: 'tab'}).some(function (window) {
            return (window.location.href.indexOf(tabName + '.html') > 0);
        });
        return tabFound;
    },

    htmlEncode: function (text) {
        return document.createElement('pre').appendChild(document.createTextNode(text)).parentNode.innerHTML;
    },

    getChromeVersion: function () {
        var raw = navigator.userAgent.match(/Chrom(e|ium)\/([0-9]+)\./);
        return raw ? parseInt(raw[2], 10) : false;
    },

    generateHashCode: function (text) {
        var hash = 0, i, chr, len;
        if (!text) return hash;
        for (i = 0, len = text.length; i < len; i++) {
            chr = text.charCodeAt(i);
            hash = ((hash << 5) - hash) + chr;
            hash |= 0; // Convert to 32bit integer
        }
        return Math.abs(hash);
    },

    buildSuspendUnsuspendHotkey: function (callback) {
        var printableHotkey = '';
        chrome.commands.getAll(function (commands) {
            var toggleCommand = commands.find(function (command) {
                return (command.name === '1-suspend-tab');
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

    performPostSaveUpdates: function (changedSettingKeys) {

        //if interval, or form input preferences have changed then reset the content scripts
        var contentScriptPreferencesToUpdate = [];
        if (this.contains(changedSettingKeys, gsStorage.SUSPEND_TIME)) {
            contentScriptPreferencesToUpdate.push(gsStorage.SUSPEND_TIME);
        }
        if (this.contains(changedSettingKeys, gsStorage.IGNORE_FORMS)) {
            contentScriptPreferencesToUpdate.push(gsStorage.IGNORE_FORMS);
        }
        if (this.contains(changedSettingKeys, gsStorage.IGNORE_ACTIVE_TABS)) {
            contentScriptPreferencesToUpdate.push(gsStorage.IGNORE_ACTIVE_TABS);
        }
        if (contentScriptPreferencesToUpdate.length > 0) {
            gsMessages.sendResetToAllContentScripts(contentScriptPreferencesToUpdate);
        }

        //if discarding strategy has changed then updated discarded and suspended tabs
        if (this.contains(changedSettingKeys, gsStorage.SUSPEND_IN_PLACE_OF_DISCARD)) {
            var suspendInPlaceOfDiscard = gsStorage.getOption(gsStorage.SUSPEND_IN_PLACE_OF_DISCARD);
            chrome.tabs.query({}, function (tabs) {
                var currentNormalTabs = tabs.filter(function (o) {return gsUtils.isNormalTab(o, true); });
                currentNormalTabs.forEach(function (normalTab) {
                    if (gsUtils.isDiscardedTab(normalTab) && suspendInPlaceOfDiscard) {
                        var suspendedUrl = gsUtils.generateSuspendedUrl(normalTab.url, normalTab.title, 0);
                        gsSuspendManager.forceTabSuspension(normalTab, suspendedUrl);
                    }
                });
            });
        }

        //if theme or screenshot preferences have changed then refresh suspended tabs
        var suspendedTabPreferencesToUpdate = {};
        if (this.contains(changedSettingKeys, gsStorage.THEME)) {
            suspendedTabPreferencesToUpdate.theme = gsStorage.getOption(gsStorage.THEME);
        }
        if (this.contains(changedSettingKeys, gsStorage.SCREEN_CAPTURE)) {
            suspendedTabPreferencesToUpdate.previewMode = gsStorage.getOption(gsStorage.SCREEN_CAPTURE);
        }
        if (Object.keys(suspendedTabPreferencesToUpdate).length > 0) {
            gsMessages.sendRefreshToAllSuspendedTabs(suspendedTabPreferencesToUpdate);
        }

        //if context menu has been disabled then remove from chrome
        if (this.contains(changedSettingKeys, gsStorage.ADD_CONTEXT)) {
            var addContextMenu = gsStorage.getOption(gsStorage.ADD_CONTEXT);
            tgs.buildContextMenu(addContextMenu);
        }

        //if screenshot preferences have changed then update the queue parameters
        if (this.contains(changedSettingKeys, gsStorage.SCREEN_CAPTURE) ||
            this.contains(changedSettingKeys, gsStorage.SCREEN_CAPTURE_FORCE)) {
            gsSuspendManager.updateQueueParameters();
        }
    },

    getWindowFromSession: function (windowId, session) {
        var window = false;
        session.windows.some(function (curWindow) {
            //leave this as a loose matching as sometimes it is comparing strings. other times ints
            if (curWindow.id == windowId) { // eslint-disable-line eqeqeq
                window = curWindow;
                return true;
            }
        });
        return window;
    },

    saveWindowsToSessionHistory: function (sessionId, windowsArray) {
        var session = {
            sessionId: sessionId,
            windows: windowsArray,
            date: (new Date()).toISOString()
        };
        gsStorage.updateSession(session);
    },

    removeInternalUrlsFromSession: function (session) {
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

    getSimpleDate: function (date) {
        var d = new Date(date);
        return ('0' + d.getDate()).slice(-2) + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
            d.getFullYear() + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    },

    getHumanDate: function (date) {
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
    },
};
