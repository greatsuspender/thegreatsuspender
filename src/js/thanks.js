/*global chrome */
(function() {
  'use strict';
  if (
    !chrome.extension.getBackgroundPage() ||
    !chrome.extension.getBackgroundPage().gsUtils
  ) {
    window.setTimeout(() => location.replace(location.href), 1000);
    return;
  }

  var gsAnalytics = chrome.extension.getBackgroundPage().gsAnalytics;
  var gsUtils = chrome.extension.getBackgroundPage().gsUtils;

  gsUtils.documentReadyAndLocalisedAsPromsied(document).then(function() {
    //do nothing
  });
  gsAnalytics.reportPageView('thanks.html');
})();
