/*global tgs, gsUtils, gsChrome, gsTabSelector, gsTabSuspendManager, gsMessages  */
// eslint-disable-next-line no-unused-vars
var gsTabActions = (function() {
  'use strict';

  async function suspendHighlightedTab() {
    const activeTab = await gsTabSelector.getCurrentlyActiveTab();
    if (activeTab) {
      gsTabSuspendManager.queueTabForSuspension(activeTab, 1);
    }
  }

  async function suspendSelectedTabs(selectedTabs) {
    for (const tab of selectedTabs) {
      if (!gsUtils.isSuspendedTab(tab)) {
        gsTabSuspendManager.queueTabForSuspension(tab, 1);
      }
    }
  }

  async function suspendAllTabs(force) {
    const forceLevel = force ? 1 : 2;
    const activeTab = await gsTabSelector.getCurrentlyActiveTab();
    if (!activeTab) {
      gsUtils.warning(
        'background',
        'Could not determine currently active window.'
      );
      return;
    }
    const curWindow = await gsChrome.windowsGet(activeTab.windowId);
    for (const tab of curWindow.tabs) {
      if (!tab.active) {
        gsTabSuspendManager.queueTabForSuspension(tab, forceLevel);
      }
    }
  }

  async function suspendAllTabsInAllWindows(force) {
    const forceLevel = force ? 1 : 2;
    const tabs = await gsChrome.tabsQuery();
    for (const tab of tabs) {
      gsTabSuspendManager.queueTabForSuspension(tab, forceLevel);
    }
  }

  async function unsuspendTab(tab) {
    if (!gsUtils.isSuspendedTab(tab)) return;

    const scrollPosition = gsUtils.getSuspendedScrollPosition(tab.url);
    tgs.setTabStatePropForTabId(tab.id, tgs.STATE_SCROLL_POS, scrollPosition);

    let originalUrl = gsUtils.getOriginalUrl(tab.url);
    if (originalUrl) {
      // Reloading chrome.tabs.update causes a history item for the suspended tab
      // to be made in the tab history. We clean this up on tab updated hook
      tgs.setTabStatePropForTabId(
        tab.id,
        tgs.STATE_HISTORY_URL_TO_REMOVE,
        tab.url
      );
      if (tab.autoDiscardable) {
        tgs.setTabStatePropForTabId(
          tab.id,
          tgs.STATE_SET_AUTODISCARDABLE,
          tab.url
        );
      }
      // NOTE: Temporarily disable autoDiscardable, as there seems to be a bug
      // where discarded (and frozen?) suspended tabs will not unsuspend with
      // chrome.tabs.update if this is set to true. This gets unset again after tab
      // has reloaded via the STATE_SET_AUTODISCARDABLE flag.
      gsUtils.log(tab.id, 'Unsuspending tab via chrome.tabs.update');
      await gsChrome.tabsUpdate(tab.id, {
        url: originalUrl,
        autoDiscardable: false,
      });
      return;
    }

    gsUtils.log(tab.id, 'Failed to execute unsuspend tab.');
  }

  async function unsuspendHighlightedTab() {
    const activeTab = await gsTabSelector.getCurrentlyActiveTab();
    if (activeTab && gsUtils.isSuspendedTab(activeTab)) {
      await unsuspendTab(activeTab);
    }
  }

  async function unsuspendSelectedTabs(selectedTabs) {
    for (const tab of selectedTabs) {
      if (gsUtils.isSuspendedTab(tab)) {
        gsTabSuspendManager.unqueueTabForSuspension(tab);
        await unsuspendTab(tab);
      }
    }
  }

  async function unsuspendAllTabs() {
    const activeTab = await gsTabSelector.getCurrentlyActiveTab();
    if (!activeTab) {
      gsUtils.warning(
        'background',
        'Could not determine currently active window.'
      );
      return;
    }
    const curWindow = await gsChrome.windowsGet(activeTab.windowId);
    for (const tab of curWindow.tabs) {
      gsTabSuspendManager.unqueueTabForSuspension(tab);
      if (gsUtils.isSuspendedTab(tab)) {
        await unsuspendTab(tab);
      } else if (gsUtils.isNormalTab(tab) && !tab.active) {
        tgs.resetAutoSuspendTimerForTab(tab);
      }
    }
  }

  async function unsuspendAllTabsInAllWindows() {
    const currentWindow = await gsChrome.windowsGetLastFocused();
    const tabs = await gsChrome.tabsQuery();
    // Because of the way that unsuspending steals window focus, we defer the suspending of tabs in the
    // current window until last
    const deferredTabs = [];
    for (const tab of tabs) {
      gsTabSuspendManager.unqueueTabForSuspension(tab);
      if (gsUtils.isSuspendedTab(tab)) {
        if (tab.windowId === currentWindow.id) {
          deferredTabs.push(tab);
        } else {
          await unsuspendTab(tab);
        }
      } else if (gsUtils.isNormalTab(tab)) {
        tgs.resetAutoSuspendTimerForTab(tab);
      }
    }
    for (const tab of deferredTabs) {
      await unsuspendTab(tab);
    }
  }

  // forceAction: 1=suspend 2=unsuspend
  async function toggleSuspendedStateOfSelectedTabs(forceAction) {
    const selectedTabs = await gsTabSelector.getCurrentlySelectedTabs();
    if (!selectedTabs || selectedTabs.length === 0) {
      return;
    }
    const activeTab = selectedTabs[0];
    let action = forceAction || (gsUtils.isSuspendedTab(activeTab) ? 2 : 1);
    if (action === 1) {
      await suspendSelectedTabs(selectedTabs);
    } else if (action === 2) {
      await unsuspendSelectedTabs(selectedTabs);
    }
  }

  async function whitelistHighlightedTab(includePath) {
    includePath = includePath || false;
    const activeTab = await gsTabSelector.getCurrentlyActiveTab();
    if (activeTab) {
      if (gsUtils.isSuspendedTab(activeTab)) {
        let url = gsUtils.getRootUrl(
          gsUtils.getOriginalUrl(activeTab.url),
          includePath,
          false
        );
        gsUtils.saveToWhitelist(url);
        await unsuspendTab(activeTab);
      } else if (gsUtils.isNormalTab(activeTab)) {
        let url = gsUtils.getRootUrl(activeTab.url, includePath, false);
        gsUtils.saveToWhitelist(url);
        const status = await tgs.calculateTabStatus(activeTab, null);
        tgs.setIconStatus(status, activeTab.id);
      }
    }
  }

  async function unwhitelistHighlightedTab() {
    const activeTab = await gsTabSelector.getCurrentlyActiveTab();
    if (activeTab) {
      gsUtils.removeFromWhitelist(activeTab.url);
      const status = await tgs.calculateTabStatus(activeTab, null);
      tgs.setIconStatus(status, activeTab.id);
    }
  }

  async function setTempWhitelistStateForTab(tab) {
    const tabInfo = await new Promise(resolve => {
      gsMessages.sendTemporaryWhitelistToContentScript(tab.id, function(
        error,
        contentScriptInfo
      ) {
        if (error) {
          gsUtils.warning(
            tab.id,
            'Failed to sendTemporaryWhitelistToContentScript',
            error
          );
        }
        resolve(contentScriptInfo);
      });
    });
    const contentScriptStatus =
      tabInfo && tabInfo.status ? tabInfo.status : null;
    const newStatus = await tgs.calculateTabStatus(tab, contentScriptStatus);
    tgs.setIconStatus(newStatus, tab.id);

    //This is a hotfix for issue #723
    if (newStatus === 'tempWhitelist' && tab.autoDiscardable) {
      await gsChrome.tabsUpdate(tab.id, {
        autoDiscardable: false,
      });
    }
  }

  async function unsetTempWhitelistStateForTab(tab) {
    const tabInfo = await new Promise(resolve => {
      gsMessages.sendUndoTemporaryWhitelistToContentScript(tab.id, function(
        error,
        contentScriptInfo
      ) {
        if (error) {
          gsUtils.warning(
            tab.id,
            'Failed to sendUndoTemporaryWhitelistToContentScript',
            error
          );
        }
        resolve(contentScriptInfo);
      });
    });
    const contentScriptStatus =
      tabInfo && tabInfo.status ? tabInfo.status : null;
    const newStatus = await tgs.calculateTabStatus(tab, contentScriptStatus);
    tgs.setIconStatus(newStatus, tab.id);

    //This is a hotfix for issue #723
    if (newStatus !== 'tempWhitelist' && !tab.autoDiscardable) {
      await gsChrome.tabsUpdate(tab.id, {
        autoDiscardable: true,
      });
    }
  }

  async function toggleTempWhitelistStateOfHighlightedTab() {
    await toggleTempWhitelistStateOfSelectedTabs(true);
  }

  // Action is an int. 1=tempWhitelist 2=removeFromTempWhitelist
  async function toggleTempWhitelistStateOfSelectedTabs(onlyActiveTab) {
    const activeTab = await gsTabSelector.getCurrentlyActiveTab();
    if (!activeTab) {
      return;
    }

    const status = await tgs.calculateTabStatus(activeTab, null);
    let action;
    if (status === gsUtils.STATUS_ACTIVE || status === gsUtils.STATUS_NORMAL) {
      action = 1;
    } else if (
      status === gsUtils.STATUS_TEMPWHITELIST ||
      status === gsUtils.STATUS_FORMINPUT
    ) {
      action = 2;
    } else {
      gsUtils.log(
        activeTab.id,
        'Aborting tempWhitelist toggle as current tab is not normal'
      );
      return;
    }

    let selectedTabs = await gsChrome.tabsQuery({
      highlighted: true,
      windowId: activeTab.windowId,
    });
    selectedTabs =
      onlyActiveTab || selectedTabs.length === 1 ? [activeTab] : selectedTabs;
    for (const tab of selectedTabs) {
      if (gsUtils.isNormalTab(tab, true)) {
        if (action === 1) {
          // if tempWhitelisting
          await setTempWhitelistStateForTab(tab);
        } else if (action === 2) {
          // if removing from tempWhitelist
          await unsetTempWhitelistStateForTab(tab);
        }
      }
    }
    return;
  }

  return {
    suspendHighlightedTab,
    suspendSelectedTabs,
    suspendAllTabs,
    suspendAllTabsInAllWindows,
    unsuspendTab,
    unsuspendHighlightedTab,
    unsuspendSelectedTabs,
    unsuspendAllTabs,
    unsuspendAllTabsInAllWindows,
    toggleSuspendedStateOfSelectedTabs,
    whitelistHighlightedTab,
    unwhitelistHighlightedTab,
    setTempWhitelistStateForTab,
    unsetTempWhitelistStateForTab,
    toggleTempWhitelistStateOfHighlightedTab,
    toggleTempWhitelistStateOfSelectedTabs,
  };
})();
