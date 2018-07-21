/*global chrome */
(function() {
  'use strict';

  var gsAnalytics = chrome.extension.getBackgroundPage().gsAnalytics;
  var gsUtils = chrome.extension.getBackgroundPage().gsUtils;

  gsUtils.documentReadyAndLocalisedAsPromsied(document).then(function() {
    //do nothing
  });
  gsAnalytics.reportPageView('thanks.html');
})();
