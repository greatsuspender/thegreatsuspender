/*global chrome, gsUtils */
'use strict';
// eslint-disable-next-line no-unused-vars
var gsChrome = {
  cookiesGetAll: function() {
    return new Promise(resolve => {
      chrome.cookies.getAll({}, cookies => {
        if (chrome.runtime.lastError) {
          gsUtils.warning('chromeCookies', chrome.runtime.lastError);
          cookies = [];
        }
        resolve(cookies);
      });
    });
  },
  cookiesRemove: function(url, name) {
    return new Promise(resolve => {
      if (!url || !name) {
        gsUtils.warning('chromeCookies', 'url or name not specified');
        resolve(null);
        return;
      }
      chrome.cookies.remove({ url, name }, details => {
        if (chrome.runtime.lastError) {
          gsUtils.warning('chromeCookies', chrome.runtime.lastError);
          details = null;
        }
        resolve(details);
      });
    });
  },

  tabsCreate: function(details) {
    return new Promise(resolve => {
      if (
        !details ||
        (typeof details !== 'string' && typeof details.url !== 'string')
      ) {
        gsUtils.warning('chromeTabs', 'url not specified');
        resolve(null);
        return;
      }
      details = typeof details === 'string' ? { url: details } : details;
      chrome.tabs.create(details, tab => {
        if (chrome.runtime.lastError) {
          gsUtils.warning('chromeTabs', chrome.runtime.lastError);
          tab = null;
        }
        resolve(tab);
      });
    });
  },
  tabsReload: function(tabId) {
    return new Promise(resolve => {
      if (!tabId) {
        gsUtils.warning('chromeTabs', 'tabId not specified');
        resolve(false);
        return;
      }
      chrome.tabs.reload(tabId, () => {
        if (chrome.runtime.lastError) {
          gsUtils.warning('chromeTabs', chrome.runtime.lastError);
          resolve(false);
          return;
        }
        resolve(true);
      });
    });
  },
  tabsUpdate: function(tabId, updateProperties) {
    return new Promise(resolve => {
      if (!tabId || !updateProperties) {
        gsUtils.warning(
          'chromeTabs',
          'tabId or updateProperties not specified'
        );
        resolve(null);
        return;
      }
      chrome.tabs.update(tabId, updateProperties, tab => {
        if (chrome.runtime.lastError) {
          gsUtils.warning('chromeTabs', chrome.runtime.lastError);
          tab = null;
        }
        resolve(tab);
      });
    });
  },
  tabsGet: function(tabId) {
    return new Promise(resolve => {
      if (!tabId) {
        gsUtils.warning('chromeTabs', 'tabId not specified');
        resolve(null);
        return;
      }
      chrome.tabs.get(tabId, tab => {
        if (chrome.runtime.lastError) {
          gsUtils.warning('chromeTabs', chrome.runtime.lastError);
          tab = null;
        }
        resolve(tab);
      });
    });
  },
  tabsQuery: function(queryInfo) {
    queryInfo = queryInfo || {};
    return new Promise(resolve => {
      chrome.tabs.query(queryInfo, tabs => {
        if (chrome.runtime.lastError) {
          gsUtils.warning('chromeTabs', chrome.runtime.lastError);
          tabs = [];
        }
        resolve(tabs);
      });
    });
  },
  tabsRemove: function(tabId) {
    return new Promise(resolve => {
      if (!tabId) {
        gsUtils.warning('chromeTabs', 'tabId not specified');
        resolve(null);
        return;
      }
      chrome.tabs.remove(tabId, () => {
        if (chrome.runtime.lastError) {
          gsUtils.warning('chromeTabs', chrome.runtime.lastError);
        }
        resolve();
      });
    });
  },

  windowsGetLastFocused: function() {
    return new Promise(resolve => {
      chrome.windows.getLastFocused({}, window => {
        if (chrome.runtime.lastError) {
          gsUtils.warning('chromeWindows', chrome.runtime.lastError);
          window = null;
        }
        resolve(window);
      });
    });
  },
  windowsGet: function(windowId) {
    return new Promise(resolve => {
      if (!windowId) {
        gsUtils.warning('chromeWindows', 'windowId not specified');
        resolve(null);
        return;
      }
      chrome.windows.get(windowId, { populate: true }, window => {
        if (chrome.runtime.lastError) {
          gsUtils.warning('chromeWindows', chrome.runtime.lastError);
          window = null;
        }
        resolve(window);
      });
    });
  },
  windowsGetAll: function() {
    return new Promise(resolve => {
      chrome.windows.getAll({ populate: true }, windows => {
        if (chrome.runtime.lastError) {
          gsUtils.warning('chromeWindows', chrome.runtime.lastError);
          windows = [];
        }
        resolve(windows);
      });
    });
  },
  windowsCreate: function(createData) {
    createData = createData || {};
    return new Promise(resolve => {
      chrome.windows.create(createData, window => {
        if (chrome.runtime.lastError) {
          gsUtils.warning('chromeWindows', chrome.runtime.lastError);
          window = null;
        }
        resolve(window);
      });
    });
  },
  windowsUpdate: function(windowId, updateInfo) {
    return new Promise(resolve => {
      if (!windowId || !updateInfo) {
        gsUtils.warning('chromeTabs', 'windowId or updateInfo not specified');
        resolve(null);
        return;
      }
      chrome.windows.update(windowId, updateInfo, window => {
        if (chrome.runtime.lastError) {
          gsUtils.warning('chromeWindows', chrome.runtime.lastError);
          window = null;
        }
        resolve(window);
      });
    });
  },
};
