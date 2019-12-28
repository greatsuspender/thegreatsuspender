import { warning } from './gsUtils';

export const cookiesGetAll = () => {
  return new Promise(resolve => {
    chrome.cookies.getAll({}, cookies => {
      if (chrome.runtime.lastError) {
        warning('chromeCookies', chrome.runtime.lastError);
        cookies = [];
      }
      resolve(cookies);
    });
  });
};
export const cookiesRemove = (url, name) => {
  return new Promise(resolve => {
    if (!url || !name) {
      warning('chromeCookies', 'url or name not specified');
      resolve(null);
      return;
    }
    chrome.cookies.remove({ url, name }, details => {
      if (chrome.runtime.lastError) {
        warning('chromeCookies', chrome.runtime.lastError);
        details = null;
      }
      resolve(details);
    });
  });
};

export const tabsCreate = details => {
  return new Promise(resolve => {
    if (
      !details ||
      (typeof details !== 'string' && typeof details.url !== 'string')
    ) {
      warning('chromeTabs', 'url not specified');
      resolve(null);
      return;
    }
    details = typeof details === 'string' ? { url: details } : details;
    chrome.tabs.create(details, tab => {
      if (chrome.runtime.lastError) {
        warning('chromeTabs', chrome.runtime.lastError);
        tab = null;
      }
      resolve(tab);
    });
  });
};
export const tabsReload = tabId => {
  return new Promise(resolve => {
    if (!tabId) {
      warning('chromeTabs', 'tabId not specified');
      resolve(false);
      return;
    }
    chrome.tabs.reload(tabId, () => {
      if (chrome.runtime.lastError) {
        warning('chromeTabs', chrome.runtime.lastError);
        resolve(false);
        return;
      }
      resolve(true);
    });
  });
};
export const tabsUpdate = (tabId, updateProperties) => {
  return new Promise(resolve => {
    if (!tabId || !updateProperties) {
      warning('chromeTabs', 'tabId or updateProperties not specified');
      resolve(null);
      return;
    }
    chrome.tabs.update(tabId, updateProperties, tab => {
      if (chrome.runtime.lastError) {
        warning('chromeTabs', chrome.runtime.lastError);
        tab = null;
      }
      resolve(tab);
    });
  });
};
export const tabsGet = tabId => {
  return new Promise(resolve => {
    if (!tabId) {
      warning('chromeTabs', 'tabId not specified');
      resolve(null);
      return;
    }
    chrome.tabs.get(tabId, tab => {
      if (chrome.runtime.lastError) {
        warning('chromeTabs', chrome.runtime.lastError);
        tab = null;
      }
      resolve(tab);
    });
  });
};
export const tabsQuery = queryInfo => {
  queryInfo = queryInfo || {};
  return new Promise(resolve => {
    chrome.tabs.query(queryInfo, tabs => {
      if (chrome.runtime.lastError) {
        warning('chromeTabs', chrome.runtime.lastError);
        tabs = [];
      }
      resolve(tabs);
    });
  });
};
export const tabsRemove = tabId => {
  return new Promise(resolve => {
    if (!tabId) {
      warning('chromeTabs', 'tabId not specified');
      resolve(null);
      return;
    }
    chrome.tabs.remove(tabId, () => {
      if (chrome.runtime.lastError) {
        warning('chromeTabs', chrome.runtime.lastError);
      }
      resolve();
    });
  });
};

export const windowsGetLastFocused = () => {
  return new Promise(resolve => {
    chrome.windows.getLastFocused({}, window => {
      if (chrome.runtime.lastError) {
        warning('chromeWindows', chrome.runtime.lastError);
        window = null;
      }
      resolve(window);
    });
  });
};
export const windowsGet = windowId => {
  return new Promise(resolve => {
    if (!windowId) {
      warning('chromeWindows', 'windowId not specified');
      resolve(null);
      return;
    }
    chrome.windows.get(windowId, { populate: true }, window => {
      if (chrome.runtime.lastError) {
        warning('chromeWindows', chrome.runtime.lastError);
        window = null;
      }
      resolve(window);
    });
  });
};
export const windowsGetAll = () => {
  return new Promise(resolve => {
    chrome.windows.getAll({ populate: true }, windows => {
      if (chrome.runtime.lastError) {
        warning('chromeWindows', chrome.runtime.lastError);
        windows = [];
      }
      resolve(windows);
    });
  });
};
export const windowsCreate = createData => {
  createData = createData || {};
  return new Promise(resolve => {
    chrome.windows.create(createData, window => {
      if (chrome.runtime.lastError) {
        warning('chromeWindows', chrome.runtime.lastError);
        window = null;
      }
      resolve(window);
    });
  });
};
export const windowsUpdate = (windowId, updateInfo) => {
  return new Promise(resolve => {
    if (!windowId || !updateInfo) {
      warning('chromeTabs', 'windowId or updateInfo not specified');
      resolve(null);
      return;
    }
    chrome.windows.update(windowId, updateInfo, window => {
      if (chrome.runtime.lastError) {
        warning('chromeWindows', chrome.runtime.lastError);
        window = null;
      }
      resolve(window);
    });
  });
};
