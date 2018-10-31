/*global chrome, gsAnalytics */
(function(global) {
  'use strict';

  const backgroundPage = chrome.extension.getBackgroundPage();
  if (!backgroundPage || !backgroundPage.tgs) {
    setTimeout(() => location.replace(location.href), 1000);
    return;
  }
  backgroundPage.tgs.setViewGlobals(global, 'broken');

  function init() {
    document
      .getElementById('restartExtension')
      .addEventListener('click', function() {
        chrome.runtime.reload();
      });
    document
      .getElementById('sessionManagementLink')
      .addEventListener('click', function() {
        chrome.tabs.create({ url: chrome.extension.getURL('history.html') });
      });
    gsAnalytics.reportPageView('broken.html');
  }
  if (document.readyState !== 'loading') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', function() {
      init();
    });
  }
})(this);
