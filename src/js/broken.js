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
    try {
      var gsAnalytics = chrome.extension.getBackgroundPage().gsAnalytics;
      gsAnalytics.reportPageView('broken.html');
    } catch (error) {
      //do nothing
    }
  }
  if (document.readyState !== 'loading') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', function() {
      init();
    });
  }
})();
