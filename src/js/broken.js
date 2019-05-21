/*global chrome, gsAnalytics, gsChrome */
(function(global) {
  'use strict';

  try {
    chrome.extension.getBackgroundPage().tgs.setViewGlobals(global);
  } catch (e) {
    window.setTimeout(() => window.location.reload(), 1000);
    return;
  }

  function init() {
    document
      .getElementById('restartExtension')
      .addEventListener('click', () => {
        chrome.runtime.reload();
      });
    document
      .getElementById('sessionManagementLink')
      .addEventListener('click', async () => {
        await gsChrome.tabsCreate({ url: chrome.extension.getURL('history.html') });
      });
    gsAnalytics.reportPageView('broken.html');
  }
  if (document.readyState !== 'loading') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      init();
    });
  }
})(this);
