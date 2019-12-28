import gsGlobals from './gsGlobals';
window.gsGlobals = gsGlobals;

import { initSettingsAsPromised as gsStorageInit } from './gsStorage';
import {
  initAsPromised as gsAnalyticsInit,
  performStartupReport,
  performVersionReport,
  performPingReport,
} from './gsAnalytics';
import { initAsPromised as gsFaviconInit } from './gsFavicon';
import { initAsPromised as gsTabSuspendManagerInit } from './gsTabSuspendManager';
import { initAsPromised as gsTabCheckManagerInit } from './gsTabCheckManager';
import { initAsPromised as gsTabDiscardManagerInit } from './gsTabDiscardManager';
import {
  initAsPromised as gsSessionInit,
  runStartupChecks,
  updateSessionMetrics,
} from './gsSession';
import { initAsPromised as gsTgsInit, checkForNotices } from './gsTgs';

import { error } from './gsUtils';

const noticeCheckInterval = 1000 * 60 * 60 * 12; // every 12 hours
const sessionMetricsCheckInterval = 1000 * 60 * 15; // every 15 minutes
const analyticsCheckInterval = 1000 * 60 * 60 * 23.5; // every 23.5 hours

const startNoticeCheckerJob = () => {
  checkForNotices();
  window.setInterval(checkForNotices, noticeCheckInterval);
};

const startSessionMetricsJob = () => {
  updateSessionMetrics(true);
  window.setInterval(updateSessionMetrics, sessionMetricsCheckInterval);
};

const startAnalyticsUpdateJob = () => {
  window.setInterval(() => {
    performPingReport();
    const reset = true;
    updateSessionMetrics(reset);
  }, analyticsCheckInterval);
};

Promise.resolve()
  .then(gsStorageInit) // ensure settings have been loaded and synced
  .then(() => {
    // initialise other gsLibs
    return Promise.all([
      gsAnalyticsInit(),
      gsFaviconInit(),
      gsTabSuspendManagerInit(),
      gsTabCheckManagerInit(),
      gsTabDiscardManagerInit(),
      gsSessionInit(),
    ]);
  })
  .catch(e => {
    error('background init error: ', e);
  })
  .then(runStartupChecks) // performs crash check (and maybe recovery) and tab responsiveness checks
  .catch(e => {
    error('background startup checks error: ', e);
  })
  .then(gsTgsInit) // adds handle(Un)SuspendedTabChanged listeners!
  .catch(e => {
    error('background init error: ', e);
  })
  .finally(() => {
    performStartupReport();
    performVersionReport();

    startNoticeCheckerJob();
    startSessionMetricsJob();
    startAnalyticsUpdateJob();
  });
