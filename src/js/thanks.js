/*global chrome, gsAnalytics, gsUtils */
(function(global) {
  'use strict';

  const backgroundPage = chrome.extension.getBackgroundPage();
  if (!backgroundPage || !backgroundPage.tgs) {
    setTimeout(() => location.replace(location.href), 1000);
    return;
  }
  backgroundPage.tgs.setViewGlobals(global, 'thanks');

  gsUtils.documentReadyAndLocalisedAsPromsied(document).then(function() {
    //do nothing
  });
  gsAnalytics.reportPageView('thanks.html');

})(this);
