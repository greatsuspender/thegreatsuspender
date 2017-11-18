/*global chrome, localStorage, gsStorage, gsMessages, tgs */
'use strict';

var debugInfo = true;
var debugError = true;

var gsUtils = { // eslint-disable-line no-unused-vars

    noop: function () {},

    contains: function (array, value) {
        for (var i = 0; i < array.length; i++) {
            if (array[i] === value) return true;
        }
        return false;
    },

    log: function (text, ...args) {
        if (debugInfo) {
            args = args || [];
            console.log(text, ...args);
        }
    },
    error: function (text, ...args) {
        if (debugError) {
            args = args || [];
            console.error(text, ...args);
        }
    },
    dir: function (object) {
        if (debugInfo) {
            console.dir(object);
        }
    },

    isDiscardedTab: function (tab) {
        return tab.discarded;
    },

    //tests for non-standard web pages. does not check for suspended pages!
    isSpecialTab: function (tab) {
        var url = tab.url;

        if ((url.indexOf('chrome-extension:') === 0 && url.indexOf('suspended.html') < 0) ||
            url.indexOf('chrome:') === 0 ||
            url.indexOf('chrome-devtools:') === 0 ||
            url.indexOf('file:') === 0 ||
            url.indexOf('chrome.google.com/webstore') >= 0) {
            return true;
        }
        return false;
    },

    isPinnedTab: function (tab) {
        var dontSuspendPinned = gsStorage.getOption(gsStorage.IGNORE_PINNED);
        return dontSuspendPinned && tab.pinned;
    },

    isAudibleTab: function (tab) {
        var dontSuspendAudible = gsStorage.getOption(gsStorage.IGNORE_AUDIO);
        return dontSuspendAudible && tab.audible;
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
        this.updateOptionsView();
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

    saveToWhitelist: function (newString) {
        var whitelist = gsStorage.getOption(gsStorage.WHITELIST);
        whitelist = whitelist ? whitelist + '\n' + newString : newString;
        whitelist = this.cleanupWhitelist(whitelist);
        gsStorage.setOption(gsStorage.WHITELIST, whitelist);
        gsStorage.syncSettings({ [gsStorage.WHITELIST]: whitelist });
        this.updateOptionsView();
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

    updateOptionsView: function () {
        chrome.tabs.query({ url: chrome.extension.getURL('options.html') }, function (tabs) {
            for (var i = 0; i < tabs.length; i++) {
                gsMessages.sendReloadOptionsToOptionsTab(tabs[i].id);
            }
        });
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

    getRootUrl: function (url, includePath) {
        var rootUrlStr;

        url = url || '';
        if (this.isSuspendedUrl(url) > 0) {
            url = this.getSuspendedUrl(url);
        }

        // remove scheme
        rootUrlStr = url;
        if (rootUrlStr.indexOf('//') > 0) {
            rootUrlStr = rootUrlStr.substring(rootUrlStr.indexOf('//') + 2);
        } else {
            rootUrlStr = url;
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

    performPostSaveUpdates: function (changedSettingKeys) {

        //if interval, or form input preferences have changed then reset the content scripts
        var preferencesToUpdate = [];
        if (this.contains(changedSettingKeys, gsStorage.SUSPEND_TIME)) {
            preferencesToUpdate.push(gsStorage.SUSPEND_TIME);
        }
        if (this.contains(changedSettingKeys, gsStorage.IGNORE_FORMS)) {
            preferencesToUpdate.push(gsStorage.IGNORE_FORMS);
        }
        if (preferencesToUpdate.length > 0) {
            this.resetContentScripts(preferencesToUpdate);
        }

        //if context menu has been disabled then remove from chrome
        if (this.contains(changedSettingKeys, gsStorage.ADD_CONTEXT)) {
            var addContextMenu = gsStorage.getOption(gsStorage.ADD_CONTEXT);
            tgs.buildContextMenu(addContextMenu);
        }

        //if theme settings have changed then refresh all suspended pages
        if (this.contains(changedSettingKeys, gsStorage.THEME)) {
            tgs.resuspendAllSuspendedTabs();
        }
    },

    resetContentScripts: function (preferencesToUpdate) {
        chrome.tabs.query({}, function (tabs) {
            tabs.forEach(function (currentTab) {
                if (!gsUtils.isSpecialTab(currentTab) && !gsUtils.isSuspendedTab(currentTab) && !gsUtils.isDiscardedTab(currentTab)) {
                    gsMessages.sendUpdatedPreferencesToContentScript(currentTab.id, preferencesToUpdate, function (err) {
                        if (err) {
                            gsUtils.log('Failed to resetContentScript for tabId: ' + currentTab.id + '. Tab is probably special or suspended.', err);
                        }
                    });
                }
            });
        });
    },

    recoverLostTabs: function (callback) {

        var self = this;

        callback = typeof callback !== 'function' ? this.noop : callback;

        gsStorage.fetchLastSession().then(function (lastSession) {
            if (!lastSession) {
                callback(null);
            }
            chrome.windows.getAll({ populate: true }, function (currentWindows) {
                var focusedWindow = currentWindows.find(function (currentWindow) { return currentWindow.focused; });
                var matchedCurrentWindowBySessionWindowId = self.matchCurrentWindowsWithLastSessionWindows(lastSession.windows, currentWindows);

                var recoverWindows = async function (done) {
                    //attempt to automatically restore any lost tabs/windows in their proper positions
                    for (var sessionWindow of lastSession.windows) {
                        await self.recoverWindowAsPromise(sessionWindow, matchedCurrentWindowBySessionWindowId[sessionWindow.id]);
                    }
                    if (focusedWindow) {
                        chrome.windows.update(focusedWindow.id, { focused: true }, done);
                    } else {
                        done();
                    }
                };
                recoverWindows(callback);
            });
        });
    },

    //try to match session windows with currently open windows
    matchCurrentWindowsWithLastSessionWindows: function (unmatchedSessionWindows, unmatchedCurrentWindows) {

        var self = this;
        var matchedCurrentWindowBySessionWindowId = {};

        //if there is a current window open that matches the id of the session window id then match it
        unmatchedSessionWindows.slice().forEach(function (sessionWindow) {
            var matchingCurrentWindow = unmatchedCurrentWindows.find(function (window) { return window.id === sessionWindow.id; });
            if (matchingCurrentWindow) {
                matchedCurrentWindowBySessionWindowId[sessionWindow.id] = matchingCurrentWindow;
                //remove from unmatchedSessionWindows and unmatchedCurrentWindows
                unmatchedSessionWindows = unmatchedSessionWindows.filter(function (window) { return window.id !== sessionWindow.id; });
                unmatchedCurrentWindows = unmatchedCurrentWindows.filter(function (window) { return window.id !== matchingCurrentWindow.id; });
                gsUtils.log('-> gsStorage: Matched with ids: ', sessionWindow, matchingCurrentWindow);
            }
        });

        if (unmatchedSessionWindows.length === 0 || unmatchedCurrentWindows.length === 0) {
            return matchedCurrentWindowBySessionWindowId;
        }

        //if we still have session windows that haven't been matched to a current window then attempt matching based on tab urls
        var tabMatchingObjects = self.generateTabMatchingObjects(unmatchedSessionWindows, unmatchedCurrentWindows);

        //find the tab matching objects with the highest tabMatchCounts
        while (unmatchedSessionWindows.length > 0 && unmatchedCurrentWindows.length > 0) {
            var maxTabMatchCount = Math.max(...tabMatchingObjects.map(function (o) { return o.tabMatchCount; }));
            var bestTabMatchingObject = tabMatchingObjects.find(function (o) { return o.tabMatchCount === maxTabMatchCount; });

            matchedCurrentWindowBySessionWindowId[bestTabMatchingObject.sessionWindow.id] = bestTabMatchingObject.currentWindow;

            //remove from unmatchedSessionWindows and unmatchedCurrentWindows
            var unmatchedSessionWindowsLengthBefore = unmatchedSessionWindows.length;
            unmatchedSessionWindows = unmatchedSessionWindows.filter(function (window) { return window.id !== bestTabMatchingObject.sessionWindow.id; });
            unmatchedCurrentWindows = unmatchedCurrentWindows.filter(function (window) { return window.id !== bestTabMatchingObject.currentWindow.id; });
            gsUtils.log('-> gsStorage: Matched with tab count of ' + maxTabMatchCount + ': ', bestTabMatchingObject.sessionWindow, bestTabMatchingObject.currentWindow);

            //remove from tabMatchingObjects
            tabMatchingObjects = tabMatchingObjects.filter(function (o) { return o.sessionWindow !== bestTabMatchingObject.sessionWindow & o.currentWindow !== bestTabMatchingObject.currentWindow; });

            //safety check to make sure we dont get stuck in infinite loop. should never happen though.
            if (unmatchedSessionWindows.length >= unmatchedSessionWindowsLengthBefore) {
                break;
            }
        }

        return matchedCurrentWindowBySessionWindowId;
    },

    generateTabMatchingObjects: function (sessionWindows, currentWindows) {

        var self = this;

        var unsuspendedSessionUrlsByWindowId = {};
        sessionWindows.forEach(function (sessionWindow) {
            unsuspendedSessionUrlsByWindowId[sessionWindow.id] = [];
            sessionWindow.tabs.forEach(function (curTab) {
                if (!self.isSpecialTab(curTab) && !self.isSuspendedTab(curTab)) {
                    unsuspendedSessionUrlsByWindowId[sessionWindow.id].push(curTab.url);
                }
            });
        });
        var unsuspendedCurrentUrlsByWindowId = {};
        currentWindows.forEach(function (currentWindow) {
            unsuspendedCurrentUrlsByWindowId[currentWindow.id] = [];
            currentWindow.tabs.forEach(function (curTab) {
                if (!self.isSpecialTab(curTab) && !self.isSuspendedTab(curTab)) {
                    unsuspendedCurrentUrlsByWindowId[currentWindow.id].push(curTab.url);
                }
            });
        });

        var tabMatchingObjects = [];
        sessionWindows.forEach(function (sessionWindow) {
            currentWindows.forEach(function (currentWindow) {
                var unsuspendedSessionUrls = unsuspendedSessionUrlsByWindowId[sessionWindow.id];
                var unsuspendedCurrentUrls = unsuspendedCurrentUrlsByWindowId[currentWindow.id];
                var matchCount = unsuspendedCurrentUrls.filter(function (url) { return unsuspendedSessionUrls.includes(url); }).length;
                tabMatchingObjects.push({
                    tabMatchCount: matchCount,
                    sessionWindow: sessionWindow,
                    currentWindow: currentWindow
                });
            });
        });

        return tabMatchingObjects;
    },

    recoverWindowAsPromise: function (sessionWindow, currentWindow) {

        var self = this,
            currentTabIds = [],
            currentTabUrls = [];

        return new Promise(function (resolve, reject) {

            //if we have been provided with a current window to recover into
            if (currentWindow) {
                currentWindow.tabs.forEach(function (currentTab) {
                    currentTabIds.push(currentTab.id);
                    currentTabUrls.push(currentTab.url);
                });

                sessionWindow.tabs.forEach(function (sessionTab) {

                    //if current tab does not exist then recreate it
                    if (!self.isSpecialTab(sessionTab) &&
                        !currentTabUrls.includes(sessionTab.url) && !currentTabIds.includes(sessionTab.id)) {
                        chrome.tabs.create({
                            windowId: currentWindow.id,
                            url: sessionTab.url,
                            index: sessionTab.index,
                            pinned: sessionTab.pinned,
                            active: false
                        });
                    }
                });
                resolve();

            //else restore entire window
            } else if (sessionWindow.tabs.length > 0) {
                gsUtils.log('-> gsStorage: Could not find match for sessionWindow: ', sessionWindow);

                //create list of urls to open
                var tabUrls = [];
                sessionWindow.tabs.forEach(function (sessionTab) {
                    tabUrls.push(sessionTab.url);
                });
                chrome.windows.create({url: tabUrls, focused: false}, resolve);
            }
        });
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
