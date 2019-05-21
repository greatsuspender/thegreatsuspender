/*global tgs, gsChrome, gsUtils, gsTabActions, gsTabSelector, gsTabSuspendManager, gsTabState  */
// eslint-disable-next-line no-unused-vars
var gsEvents = (function() {
  'use strict';

  function initAsPromised() {
    return new Promise(async resolve => {
      addCommandListeners();
      addMessageListeners();
      addChromeListeners();
      await addMiscListeners();
      gsUtils.log('gsEvents', 'init successful');
      resolve();
    });
  }

  //HANDLERS FOR KEYBOARD SHORTCUTS
  function addCommandListeners() {
    chrome.commands.onCommand.addListener(async command => {
      if (command === '1-suspend-tab') {
        await gsTabActions.toggleSuspendedStateOfSelectedTabs();
      } else if (command === '2-toggle-temp-whitelist-tab') {
        await gsTabActions.toggleTempWhitelistStateOfSelectedTabs();
      } else if (command === '3-suspend-active-window') {
        await gsTabActions.suspendAllTabs(false);
      } else if (command === '3b-force-suspend-active-window') {
        await gsTabActions.suspendAllTabs(true);
      } else if (command === '4-unsuspend-active-window') {
        await gsTabActions.unsuspendAllTabs();
      } else if (command === '4b-soft-suspend-all-windows') {
        await gsTabActions.suspendAllTabsInAllWindows(false);
      } else if (command === '5-suspend-all-windows') {
        await gsTabActions.suspendAllTabsInAllWindows(true);
      } else if (command === '6-unsuspend-all-windows') {
        await gsTabActions.unsuspendAllTabsInAllWindows();
      }
    });
  }

  //HANDLERS FOR MESSAGE REQUESTS

  function messageRequestListener(request, sender, sendResponse) {
    gsUtils.log(
      sender.tab.id,
      'background messageRequestListener',
      request.action
    );

    if (request.action === 'updateFormInputState') {
      const contentScriptStatus =
        request && request.status ? request.status : null;
      //This is a hotfix for issue #723
      if (contentScriptStatus === 'formInput') {
        gsTabActions.setAutoDiscardableStateForTab(false);
      } else if (!sender.tab.autoDiscardable) {
        gsTabActions.setAutoDiscardableStateForTab(true);
      }
      tgs.updateIconStatusForTab(sender.tab, contentScriptStatus); //async. unhandled promise.
      sendResponse();
      return false;
    }

    if (request.action === 'savePreviewData') {
      gsTabSuspendManager.handlePreviewImageResponse(
        sender.tab,
        request.previewUrl,
        request.errorMsg
      ); // async. unhandled promise
      sendResponse();
      return false;
    }

    // Fallback to empty response to ensure callback is made
    sendResponse();
    return false;
  }

  function externalMessageRequestListener(request, sender, sendResponse) {
    gsUtils.log('background', 'external message request: ', request, sender);

    if (!request.action || !['suspend', 'unsuspend'].includes(request.action)) {
      sendResponse('Error: unknown request.action: ' + request.action);
      return false;
    }

    // wrap this in an anonymous async function so we can use await
    (async function() {
      let tab;
      if (request.tabId) {
        if (typeof request.tabId !== 'number') {
          sendResponse('Error: tabId must be an int');
          return;
        }
        tab = await gsChrome.tabsGet(request.tabId);
        if (!tab) {
          sendResponse('Error: no tab found with id: ' + request.tabId);
          return;
        }
      } else {
        tab = await gsTabSelector.getCurrentlyActiveTab();
      }
      if (!tab) {
        sendResponse('Error: failed to find a target tab');
        return;
      }

      if (request.action === 'suspend') {
        if (gsUtils.isSuspendedTab(tab, true)) {
          sendResponse('Error: tab is already suspended');
          return;
        }

        gsTabSuspendManager.queueTabForSuspension(tab, 1);
        sendResponse();
        return;
      }

      if (request.action === 'unsuspend') {
        if (!gsUtils.isSuspendedTab(tab)) {
          sendResponse('Error: tab is not suspended');
          return;
        }

        await gsTabActions.unsuspendTab(tab);
        sendResponse();
        return;
      }
    })();
    return true;
  }

  function addMessageListeners() {
    chrome.runtime.onMessage.addListener(messageRequestListener);
    //attach listener to runtime for external messages, to allow
    //interoperability with other extensions in the manner of an API
    chrome.runtime.onMessageExternal.addListener(
      externalMessageRequestListener
    );
  }

  function addChromeListeners() {
    chrome.windows.onFocusChanged.addListener(async windowId => {
      await tgs.handleWindowFocusChanged(windowId);
    });
    chrome.tabs.onActivated.addListener(async activeInfo => {
      await tgs.handleTabFocusChanged(activeInfo.tabId, activeInfo.windowId);
    });
    chrome.tabs.onReplaced.addListener(async (addedTabId, removedTabId) => {
      gsTabState.updateTabIdReferences(addedTabId, removedTabId);
    });
    chrome.tabs.onCreated.addListener(async tab => {
      await tgs.handleTabCreated(tab);
    });
    chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
      await tgs.handleTabRemoved(tabId);
    });
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      await tgs.handleTabUpdated(tab, changeInfo);
    });
    chrome.windows.onCreated.addListener(async window => {
      await tgs.handleWindowCreated(window);
    });
    chrome.windows.onRemoved.addListener(async windowId => {
      await tgs.handleWindowRemoved(windowId);
    });
  }

  async function addMiscListeners() {
    //add listener for battery state changes
    if (navigator.getBattery) {
      const battery = await navigator.getBattery();
      await tgs.handleBatteryChargingChange(battery);
      battery.onchargingchange = async () => {
        await tgs.handleBatteryChargingChange(battery);
      };
    }

    //add listeners for online/offline state changes
    window.addEventListener('online', async () => {
      await tgs.handleOnlineStatusChange(true);
    });
    window.addEventListener('offline', async () => {
      await tgs.handleOnlineStatusChange(false);
    });
  }

  return {
    initAsPromised,
  };
})();
