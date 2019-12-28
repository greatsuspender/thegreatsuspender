/*global ga  */
'use strict';

import {
  SCREEN_CAPTURE,
  SUSPEND_TIME,
  NO_NAG,
  DISCARD_AFTER_SUSPEND,
  SM_TIMESTAMP,
  SM_TOTAL_TAB_COUNT,
  SM_SUSPENDED_TAB_COUNT,
  getOption,
  fetchSessionMetrics,
} from './gsStorage';
import {
  getStartupType,
  getTabCheckTimeTakenInSeconds,
  getRecoveryTimeTakenInSeconds,
  getStartupLastVersion,
} from './gsSession';
import { log, warning } from './gsUtils';

const DIMENSION_VERSION = 'dimension1';
const DIMENSION_SCREEN_CAPTURE = 'dimension2';
const DIMENSION_SUSPEND_TIME = 'dimension3';
const DIMENSION_DONATED = 'dimension4';
const DIMENSION_DISCARD_AFTER_SUSPEND = 'dimension5';

const METRIC_SUSPENDED_TAB_COUNT = 'metric1';
const METRIC_TOTAL_TAB_COUNT = 'metric2';
const METRIC_TAB_CHECK_TIME_TAKEN = 'metric3';
const METRIC_TAB_RECOVER_TIME_TAKEN = 'metric4';

export const initAsPromised = () => {
  return new Promise(function(resolve) {
    try {
      ga('create', 'UA-52338347-2', 'auto');
      ga('set', 'checkProtocolTask', function() {
        //
      });
      ga('require', 'displayfeatures');
    } catch (e) {
      warning('gsAnalytics', e);
    }
    log('gsAnalytics', 'init successful');
    resolve();
  });
};

export const setUserDimensions = () => {
  const dimensions = {
    [DIMENSION_VERSION]: chrome.runtime.getManifest().version + '',
    [DIMENSION_SCREEN_CAPTURE]: getOption(SCREEN_CAPTURE) + '',
    [DIMENSION_SUSPEND_TIME]: getOption(SUSPEND_TIME) + '',
    [DIMENSION_DONATED]: getOption(NO_NAG) + '',
    [DIMENSION_DISCARD_AFTER_SUSPEND]: getOption(DISCARD_AFTER_SUSPEND) + '',
  };
  log('gsAnalytics', 'Setting dimensions', dimensions);
  ga('set', dimensions);
};

export const performStartupReport = () => {
  const category = 'System';
  const action = getStartupType();

  const metrics = {};
  const sessionMetrics = fetchSessionMetrics();
  if (sessionMetrics && sessionMetrics[SM_TIMESTAMP]) {
    metrics[METRIC_SUSPENDED_TAB_COUNT] =
      sessionMetrics[SM_SUSPENDED_TAB_COUNT];
    metrics[METRIC_TOTAL_TAB_COUNT] = sessionMetrics[SM_TOTAL_TAB_COUNT];
  }
  const tabCheckTimeTaken = getTabCheckTimeTakenInSeconds();
  if (!isNaN(tabCheckTimeTaken) && parseInt(tabCheckTimeTaken) >= 0) {
    metrics[METRIC_TAB_CHECK_TIME_TAKEN] = tabCheckTimeTaken;
  }
  const recoveryTimeTaken = getRecoveryTimeTakenInSeconds();
  if (!isNaN(recoveryTimeTaken) && parseInt(recoveryTimeTaken) >= 0) {
    metrics[METRIC_TAB_RECOVER_TIME_TAKEN] = recoveryTimeTaken;
  }
  log('gsAnalytics', 'Event: ', category, action, metrics);
  ga('send', 'event', category, action, metrics);
};

export const performVersionReport = () => {
  const startupType = getStartupType();
  if (!['Install', 'Update'].includes(startupType)) {
    return;
  }

  const category = 'Version';
  const action = startupType + 'Details';
  const startupLastVersion = getStartupLastVersion();
  const curVersion = chrome.runtime.getManifest().version;
  const label =
    startupLastVersion !== curVersion
      ? `${startupLastVersion} -> ${curVersion}`
      : curVersion;

  log('gsAnalytics', 'Event: ', category, action, label);
  ga('send', 'event', category, action, label);
};

export const performPingReport = () => {
  const category = 'System';
  const action = 'Ping';

  const metrics = {};
  const sessionMetrics = fetchSessionMetrics();
  if (sessionMetrics && sessionMetrics[SM_TIMESTAMP]) {
    metrics[METRIC_SUSPENDED_TAB_COUNT] =
      sessionMetrics[SM_SUSPENDED_TAB_COUNT];
    metrics[METRIC_TOTAL_TAB_COUNT] = sessionMetrics[SM_TOTAL_TAB_COUNT];
  }
  log('gsAnalytics', 'Event: ', category, action, metrics);
  ga('send', 'event', category, action, metrics);
};

export const reportPageView = pageName => {
  ga('send', 'pageview', pageName);
};
export const reportEvent = (category, action, label) => {
  ga('send', 'event', category, action, label);
};
export const reportException = errorMessage => {
  ga('send', 'exception', {
    exDescription: errorMessage,
    exFatal: false,
  });
};

(function(i, s, o, g, r, a, m) {
  i['GoogleAnalyticsObject'] = r;
  (i[r] =
    i[r] ||
    function() {
      // eslint-disable-next-line prefer-rest-params
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
