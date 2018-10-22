/*global gsUtils */
// eslint-disable-next-line no-unused-vars
function GsTabQueue(queueId, queueProps) {
  return (function() {
    'use strict';

    const STATUS_QUEUED = 'queued';
    const STATUS_IN_PROGRESS = 'inProgress';
    const STATUS_SLEEPING = 'sleeping';

    const DEFAULT_CONCURRENT_EXECUTORS = 1;
    const DEFAULT_EXECUTOR_TIMEOUT = 1000;
    const DEFAULT_MAX_REQUEUE_ATTEMPTS = 5;
    const DEFAULT_REQUEUE_DELAY = 5000;
    const PROCESSING_QUEUE_CHECK_INTERVAL = 50;

    const _queueProperties = {
      concurrentExecutors: DEFAULT_CONCURRENT_EXECUTORS,
      executorTimeout: DEFAULT_EXECUTOR_TIMEOUT,
      maxRequeueAttempts: DEFAULT_MAX_REQUEUE_ATTEMPTS,
      executorFn: (tab, resolve, reject, requeue) => resolve(true),
      exceptionFn: (tab, resolve, reject, requeue) => resolve(false),
    };
    const _tabDetailsByTabId = {};
    let _processingQueueTimer = null;
    let _queueId = queueId;

    setQueueProperties(queueProps);

    function setQueueProperties(queueProps) {
      for (const propName of Object.keys(queueProps)) {
        _queueProperties[propName] = queueProps[propName];
      }
      if (!isValidInteger(_queueProperties.concurrentExecutors)) {
        throw new Error(
          'concurrentExecutors must be an integer greater than 0'
        );
      }
      if (!isValidInteger(_queueProperties.executorTimeout)) {
        throw new Error('executorTimeout must be an integer greater than 0');
      }
      if (!isValidInteger(_queueProperties.maxRequeueAttempts)) {
        throw new Error('maxRequeueAttempts must be an integer greater than 0');
      }
      if (!(typeof _queueProperties.executorFn === 'function')) {
        throw new Error('executorFn must be a function');
      }
      if (!(typeof _queueProperties.exceptionFn === 'function')) {
        throw new Error('executorFn must be a function');
      }
    }

    function isValidInteger(value) {
      return value !== null && !isNaN(Number(value));
    }

    function getTotalQueueSize() {
      return Object.keys(_tabDetailsByTabId).length;
    }

    function queueTabAsPromise(tab) {
      if (!_tabDetailsByTabId[tab.id]) {
        // gsUtils.log(tab.id, _queueId, 'Queuing new tab.');
        _tabDetailsByTabId[tab.id] = {
          tab,
          deferredPromise: createDeferredPromise(),
          status: STATUS_QUEUED,
          requeues: 0,
        };
        requestProcessQueue();
      }
      return _tabDetailsByTabId[tab.id].deferredPromise;
    }

    function unqueueTab(tab) {
      if (_tabDetailsByTabId[tab.id]) {
        gsUtils.log(tab.id, _queueId, 'Unqueuing tab.');
        delete _tabDetailsByTabId[tab.id];
        return true;
      } else {
        return false;
      }
    }

    function getQueuedTabAsPromise(tab) {
      return _tabDetailsByTabId[tab.id];
    }

    function createDeferredPromise() {
      var res, rej;
      var promise = new Promise((resolve, reject) => {
        res = resolve;
        rej = reject;
      });
      promise.resolve = o => {
        res(o);
        return promise;
      };
      promise.reject = o => {
        rej(o);
        return promise;
      };
      return promise;
    }

    function requestProcessQueue() {
      if (_processingQueueTimer === null) {
        processQueue();
        _processingQueueTimer = setTimeout(() => {
          _processingQueueTimer = null;
          processQueue();
        }, PROCESSING_QUEUE_CHECK_INTERVAL);
      }
    }

    function processQueue() {
      // gsUtils.log(_queueId, 'Processing queue...');
      const queuedTabs = [];
      const inProgressTabs = [];
      const sleepingTabs = [];
      for (let tabId of Object.keys(_tabDetailsByTabId)) {
        const tabsDetails = _tabDetailsByTabId[tabId];
        if (tabsDetails.status === STATUS_QUEUED) {
          queuedTabs.push(tabsDetails);
        } else if (tabsDetails.status === STATUS_IN_PROGRESS) {
          inProgressTabs.push(tabsDetails);
        } else if (tabsDetails.status === STATUS_SLEEPING) {
          sleepingTabs.push(tabsDetails);
        }
      }
      if (queuedTabs.length === 0) {
        gsUtils.log(_queueId, 'aborting process queue as it is empty');
        return;
      }
      if (inProgressTabs.length >= _queueProperties.concurrentExecutors) {
        gsUtils.log(_queueId, 'aborting process queue as it is full');
        return;
      }
      while (
        queuedTabs.length > 0 &&
        inProgressTabs.length < _queueProperties.concurrentExecutors
      ) {
        const tabDetails = queuedTabs.splice(0, 1)[0];
        tabDetails.status = STATUS_IN_PROGRESS;
        inProgressTabs.push(tabDetails);
        gsUtils.log(
          tabDetails.tab.id, _queueId,
          'Executing executorFn for tab.',
          tabDetails
        );

        let timer;
        const _resolveTab = result => resolveTab(tabDetails, timer, result);
        const _rejectTab = error => rejectTab(tabDetails, timer, error);
        const _requeueTab = requeueDelay => {
          requeueTab(tabDetails, timer, _resolveTab, _rejectTab, requeueDelay);
        }

        timer = setTimeout(() => {
          gsUtils.log(tabDetails.tab.id, _queueId, 'ExecutorFn timed out');
          _queueProperties.exceptionFn(
            tabDetails.tab,
            _resolveTab,
            _rejectTab,
            _requeueTab
          );
        }, _queueProperties.executorTimeout);

        _queueProperties.executorFn(
          tabDetails.tab,
          _resolveTab,
          _rejectTab,
          _requeueTab
        );
      }
      gsUtils.log(_queueId, `queuedTabs.length: ${queuedTabs.length}`);
      gsUtils.log(
        _queueId,
        `inProgressTabs.length: ${inProgressTabs.length}`
      );
    }

    function resolveTab(tabDetails, timer, result) {
      gsUtils.log(tabDetails.tab.id, _queueId, 'Queued tab resolved. Result: ', result);
      clearTimeout(timer);
      unqueueTab(tabDetails.tab);
      tabDetails.deferredPromise.resolve(result);
      processQueue();
    }

    function rejectTab(tabDetails, timer, error) {
      gsUtils.log(tabDetails.tab.id, _queueId, 'Queued tab rejected. Error: ', error);
      clearTimeout(timer);
      unqueueTab(tabDetails.tab);
      tabDetails.deferredPromise.reject(error);
      processQueue();
    }

    function requeueTab(tabDetails, timer, resolve, reject, requeueDelay) {
      clearTimeout(timer);
      requeueDelay = requeueDelay || DEFAULT_REQUEUE_DELAY;
      if (tabDetails.requeues === _queueProperties.maxRequeueAttempts) {
        gsUtils.log(tabDetails.tab.id, _queueId, 'Max requeues exceeded.');
        _queueProperties.exceptionFn(tabDetails.tab, resolve, reject, () =>
          reject('Cannot requeue once max requeues has been reached')
        );
        return;
      }

      gsUtils.log(tabDetails.tab.id, _queueId, 'Requeueing tab.');
      tabDetails.requeues += 1;
      tabDetails.status = STATUS_SLEEPING;
      processQueue();

      window.setTimeout(() => {
        tabDetails.status = STATUS_QUEUED;
        requestProcessQueue();
      }, requeueDelay);
    }

    return {
      setQueueProperties,
      getTotalQueueSize,
      queueTabAsPromise,
      unqueueTab,
      getQueuedTabAsPromise,
    };
  })();
}
