/*global chrome, gsUtils */
'use strict';
// eslint-disable-next-line no-unused-vars
var gsChrome = {
  cookiesGetAll: async function() {
    return new Promise(resolve => {
      chrome.cookies.getAll({}, cookies => {
        if (chrome.runtime.lastError) {
          gsUtils.error('chromeCookies', chrome.runtime.lastError);
          cookies = [];
        }
        resolve(cookies);
      });
    });
  },
  cookiesRemove: async function(url, name) {
    return new Promise(resolve => {
      if (!url || !name) {
        gsUtils.error('chromeCookies', 'url or name not specified');
        resolve(null);
        return;
      }
      chrome.cookies.remove({ url, name }, details => {
        if (chrome.runtime.lastError) {
          gsUtils.error('chromeCookies', chrome.runtime.lastError);
          details = null;
        }
        resolve(details);
      });
    });
  },

  tabsCreate: async function(details) {
    return new Promise(resolve => {
      if (
        !details ||
        (typeof details !== 'string' && typeof details.url !== 'string')
      ) {
        gsUtils.error('chromeTabs', 'url not specified');
        resolve(null);
        return;
      }
      details = typeof details === 'string' ? { url: details } : details;
      chrome.tabs.create(details, tab => {
        if (chrome.runtime.lastError) {
          gsUtils.error('chromeTabs', chrome.runtime.lastError);
          tab = null;
        }
        resolve(tab);
      });
    });
  },
  tabsUpdate: async function(tabId, updateProperties) {
    return new Promise(resolve => {
      if (!tabId || !updateProperties) {
        gsUtils.error('chromeTabs', 'tabId or updateProperties not specified');
        resolve(null);
        return;
      }
      chrome.tabs.update(tabId, updateProperties, tab => {
        if (chrome.runtime.lastError) {
          gsUtils.error('chromeTabs', chrome.runtime.lastError);
          tab = null;
        }
        resolve(tab);
      });
    });
  },
  tabsGet: async function(tabId) {
    return new Promise(resolve => {
      if (!tabId) {
        gsUtils.error('chromeTabs', 'tabId not specified');
        resolve(null);
        return;
      }
      chrome.tabs.get(tabId, tab => {
        if (chrome.runtime.lastError) {
          gsUtils.error('chromeTabs', chrome.runtime.lastError);
          tab = null;
        }
        resolve(tab);
      });
    });
  },
  tabsQuery: async function(queryInfo) {
    queryInfo = queryInfo || {};
    return new Promise(resolve => {
      chrome.tabs.query(queryInfo, tabs => {
        if (chrome.runtime.lastError) {
          gsUtils.error('chromeTabs', chrome.runtime.lastError);
          tabs = [];
        }
        resolve(tabs);
      });
    });
  },
  tabsRemove: async function(tabId) {
    return new Promise(resolve => {
      if (!tabId) {
        gsUtils.error('chromeTabs', 'tabId not specified');
        resolve(null);
        return;
      }
      chrome.tabs.remove(tabId, () => {
        if (chrome.runtime.lastError) {
          gsUtils.error('chromeTabs', chrome.runtime.lastError);
        }
        resolve();
      });
    });
  },

  windowsGetLastFocused: async function() {
    return new Promise(resolve => {
      chrome.windows.getLastFocused({}, window => {
        if (chrome.runtime.lastError) {
          gsUtils.error('chromeWindows', chrome.runtime.lastError);
          window = null;
        }
        resolve(window);
      });
    });
  },
  windowsGet: async function(windowId) {
    return new Promise(resolve => {
      if (!windowId) {
        gsUtils.error('chromeWindows', 'windowId not specified');
        resolve(null);
        return;
      }
      chrome.windows.get(windowId, { populate: true }, window => {
        if (chrome.runtime.lastError) {
          gsUtils.error('chromeWindows', chrome.runtime.lastError);
          window = null;
        }
        resolve(window);
      });
    });
  },
  windowsGetAll: async function() {
    return new Promise(resolve => {
      chrome.windows.getAll({ populate: true }, windows => {
        if (chrome.runtime.lastError) {
          gsUtils.error('chromeWindows', chrome.runtime.lastError);
          windows = [];
        }
        resolve(windows);
      });
    });
  },
  windowsCreate: async function(createData) {
    createData = createData || {};
    return new Promise(resolve => {
      chrome.windows.create(createData, window => {
        if (chrome.runtime.lastError) {
          gsUtils.error('chromeWindows', chrome.runtime.lastError);
          window = null;
        }
        resolve(window);
      });
    });
  },
  windowsUpdate: async function(windowId, updateInfo) {
    return new Promise(resolve => {
      if (!windowId || !updateInfo) {
        gsUtils.error('chromeTabs', 'windowId or updateInfo not specified');
        resolve(null);
        return;
      }
      chrome.windows.update(windowId, updateInfo, window => {
        if (chrome.runtime.lastError) {
          gsUtils.error('chromeWindows', chrome.runtime.lastError);
          window = null;
        }
        resolve(window);
      });
    });
  },
};
