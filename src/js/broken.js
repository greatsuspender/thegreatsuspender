/*global chrome */
(function() {
  'use strict';

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
    var gsAnalytics = chrome.extension.getBackgroundPage().gsAnalytics;
    gsAnalytics.reportPageView('broken.html');
  }
  if (document.readyState !== 'loading') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', function() {
      init();
    });
  }
})();
