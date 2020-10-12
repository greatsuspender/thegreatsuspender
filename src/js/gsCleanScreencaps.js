var gsCleanScreencaps = {
  // this will be filled with domain entries for O(1) lookups during screencaps
  blacklist: {},

  // listeners for request coming from a tab that is being suspended
  listeners: {},

  // load blacklist on initialization if option is enabled
  initAsPromised: async ()=>
  {
    const useCleanScreencap = gsStorage.getOption(
      gsStorage.ENABLE_CLEAN_SCREENCAPS
    );

    if (useCleanScreencap) {
      await gsCleanScreencaps.loadList()
    }

    return;
  },

  addListener: (tabId) => {
    // remove a listener if there is already one present. That might not be the case, but the function checks for that case.
    gsCleanScreencaps.removeListener(tabId);

    const listener = (details) => {
      try {
        const host = new URL(details.url).host
        if (gsCleanScreencaps.blacklist[host]) { return { cancel: true }; }
      } catch (err) {
        gsUtils.log('background', 'error while trying to block in gsCleanScreencaps', err)
      }
    }

    chrome.webRequest.onBeforeRequest.addListener(
      listener,
      { urls: ["<all_urls>"], types: ['image'], tabId: tabId },
      ["blocking"]
    );

    // place a callback that will remove the listener as soon as the suspension
    // of the tab succeeded or failed
    gsCleanScreencaps.listeners[tabId] = () => chrome.webRequest.onBeforeRequest.removeListener(listener)
  },

  // call the remove listener func and remove it from the hashmap
  removeListener: (tabId) => {
    let tmp;
    if (tmp = gsCleanScreencaps.listeners[tabId]) {
      delete gsCleanScreencaps[tabId];
      tmp();
    }
  },

  // do nothing but get the data out of the chrome.local.storage
  storageData: () => {
    return new Promise((res, _) => {
      chrome.storage.local.get('gsCleanScreencapsBlacklist', (storage) => res(storage.gsCleanScreencapsBlacklist))
    })
  },

  loadList: async () => {
    const stored = await gsCleanScreencaps.storageData();
    // take the blocklist out of storage if it's not existent or newer than 30 days
    if (!stored || stored.time + (3600 * 24 * 30) <= new Date().getTime()) {
      const rex = /^0.0.0.0 (.*)(?:$|#)/
      let resp = await fetch('https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts').then(resp => resp.text())
      let m;

      try {
        const blockedHosts = resp
          .split(/\n/)
          .reduce((res, e) => {
            if (m = rex.exec(e)) {
              res[m[1]] = true;
            }
            return res;
          }, {});

        gsCleanScreencaps.blacklist = blockedHosts;
        chrome.storage.local.set({ gsCleanScreencapsBlacklist: { time: new Date().getTime(), blockedHosts } })
        return blockedHosts;
      } catch (err) {
        gsUtils.log('background', 'error while loading blocklist for clean screencapture:', err)
      }
    } else {
      gsCleanScreencaps.blacklist = stored.blockedHosts;
      return stored;
    }
  }
}