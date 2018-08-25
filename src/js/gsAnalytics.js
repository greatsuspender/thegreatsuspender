/*global ga, gsStorage */
// eslint-disable-next-line no-unused-vars
var gsAnalytics = (function() {
  'use strict';

  function init() {
    ga('create', 'UA-52338347-1', 'auto');
    ga('set', 'checkProtocolTask', function() {});
    ga('require', 'displayfeatures');
  }

  function reportPageView(pageName) {
    ga('send', 'pageview', pageName);
  }
  function reportEvent(category, action, value) {
    ga('send', 'event', category, action, value);
  }
  function reportException(errorMessage) {
    ga('send', 'exception', {
      exDescription: errorMessage,
      exFatal: false,
    });
  }
  function updateDimensions() {
    ga('set', {
      dimension1: chrome.runtime.getManifest().version + '',
      dimension2: gsStorage.getOption(gsStorage.SCREEN_CAPTURE) + '',
      dimension3: gsStorage.getOption(gsStorage.SUSPEND_TIME) + '',
      dimension4: gsStorage.getOption(gsStorage.NO_NAG) + '',
    });
    ga('send', 'pageview', {
      dimension1: chrome.runtime.getManifest().version + '',
      dimension2: gsStorage.getOption(gsStorage.SCREEN_CAPTURE) + '',
      dimension3: gsStorage.getOption(gsStorage.SUSPEND_TIME) + '',
      dimension4: gsStorage.getOption(gsStorage.NO_NAG) + '',
    });
  }

  return {
    init,
    reportPageView,
    reportEvent,
    reportException,
    updateDimensions,
  };
})();

(function(i, s, o, g, r, a, m) {
  i['GoogleAnalyticsObject'] = r;
  (i[r] =
    i[r] ||
    function() {
      (i[r].q = i[r].q || []).push(arguments);
    }),
    (i[r].l = 1 * new Date());
  (a = s.createElement(o)), (m = s.getElementsByTagName(o)[0]);
  a.async = 1;
  a.src = g;
  m.parentNode.insertBefore(a, m);
})(
  window,
  document,
  'script',
  'https://www.google-analytics.com/analytics.js',
  'ga'
);
