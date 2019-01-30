/*global chrome, gsAnalytics, gsUtils */
(function(global) {
  'use strict';

  try {
    chrome.extension.getBackgroundPage().tgs.setViewGlobals(global);
  } catch (e) {
    window.setTimeout(() => window.location.reload(), 1000);
    return;
  }

  gsUtils.documentReadyAndLocalisedAsPromsied(document).then(function() {
    //do nothing
  });
  gsAnalytics.reportPageView('thanks.html');
})(this);
