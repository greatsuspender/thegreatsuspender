/*global gsUtils */
// eslint-disable-next-line no-unused-vars
function GsTabQueue(queueId, queueProps) {
  return (function() {
    'use strict';

    const STATUS_QUEUED = 'queued';
    const STATUS_IN_PROGRESS = 'inProgress';
    const STATUS_SLEEPING = 'sleeping';

    const EXCEPTION_TIMEOUT = 'timeout';
    const EXCEPTION_MAX_REQUEUES = 'maxRequeues';

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
      if (!isValidInteger(_queueProperties.concurrentExecutors, 1)) {
        throw new Error(
          'concurrentExecutors must be an integer greater than 0'
        );
      }
      if (!isValidInteger(_queueProperties.executorTimeout, 1)) {
        throw new Error('executorTimeout must be an integer greater than 0');
      }
      if (!isValidInteger(_queueProperties.maxRequeueAttempts, 0)) {
        throw new Error('maxRequeueAttempts must be an integer of 0 or more');
      }
      if (!(typeof _queueProperties.executorFn === 'function')) {
        throw new Error('executorFn must be a function');
      }
      if (!(typeof _queueProperties.exceptionFn === 'function')) {
        throw new Error('executorFn must be a function');
      }
    }

    function getQueueProperties() {
      return _queueProperties;
    }

    function isValidInteger(value, minimum) {
      return value !== null && !isNaN(Number(value) && value >= minimum);
    }

    function getTotalQueueSize() {
      return Object.keys(_tabDetailsByTabId).length;
    }

    function queueTabAsPromise(tab, executionProps) {
      executionProps = executionProps || {};
      if (!_tabDetailsByTabId[tab.id]) {
        // gsUtils.log(tab.id, _queueId, 'Queuing new tab.');
        _tabDetailsByTabId[tab.id] = {
          tab,
          executionProps,
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
        // gsUtils.log(tab.id, _queueId, 'Unqueueing tab.');
        delete _tabDetailsByTabId[tab.id];
        gsUtils.log(
          _queueId,
          `total queue size: ${Object.keys(_tabDetailsByTabId).length}`
        );
        return true;
      } else {
        return false;
      }
    }

    function getQueuedTabDetails(tab) {
      return _tabDetailsByTabId[tab.id];
    }

    function createDeferredPromise() {
      let res;
      let rej;
      const promise = new Promise((resolve, reject) => {
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
      const queuedTabDetails = [];
      const inProgressTabDetails = [];
      const sleepingTabDetails = [];
      for (let tabId of Object.keys(_tabDetailsByTabId)) {
        const tabsDetails = _tabDetailsByTabId[tabId];
        if (tabsDetails.status === STATUS_QUEUED) {
          queuedTabDetails.push(tabsDetails);
        } else if (tabsDetails.status === STATUS_IN_PROGRESS) {
          inProgressTabDetails.push(tabsDetails);
        } else if (tabsDetails.status === STATUS_SLEEPING) {
          sleepingTabDetails.push(tabsDetails);
        }
      }
      if (queuedTabDetails.length === 0) {
        // gsUtils.log(_queueId, 'aborting process queue as it is empty');
        return;
      }
      if (inProgressTabDetails.length >= _queueProperties.concurrentExecutors) {
        // gsUtils.log(_queueId, 'aborting process queue as it is full');
        return;
      }
      while (
        queuedTabDetails.length > 0 &&
        inProgressTabDetails.length < _queueProperties.concurrentExecutors
      ) {
        const tabDetails = queuedTabDetails.splice(0, 1)[0];
        tabDetails.status = STATUS_IN_PROGRESS;
        inProgressTabDetails.push(tabDetails);
        gsUtils.log(
          tabDetails.tab.id,
          _queueId,
          'Executing executorFn for tab.',
          tabDetails
        );

        let timer;
        const _resolveTabPromise = r => resolveTabPromise(tabDetails, timer, r);
        const _rejectTabPromise = e => rejectTabPromise(tabDetails, timer, e);
        const _requeueTab = requeueDelay => {
          requeueTab(
            tabDetails,
            timer,
            _resolveTabPromise,
            _rejectTabPromise,
            requeueDelay
          );
        };

        timer = setTimeout(() => {
          gsUtils.log(tabDetails.tab.id, _queueId, 'ExecutorFn timed out');
          _queueProperties.exceptionFn(
            tabDetails.tab,
            tabDetails.executionProps,
            EXCEPTION_TIMEOUT,
            _resolveTabPromise,
            _rejectTabPromise,
            _requeueTab
          );
        }, _queueProperties.executorTimeout);

        _queueProperties.executorFn(
          tabDetails.tab,
          tabDetails.executionProps,
          _resolveTabPromise,
          _rejectTabPromise,
          _requeueTab
        );
      }
      gsUtils.log(_queueId, `sleepingTabs: ${sleepingTabDetails.length}`);
      gsUtils.log(_queueId, `queuedTabs: ${queuedTabDetails.length}`);
      gsUtils.log(
        _queueId,
        `inProgress tabIds: ${inProgressTabDetails
          .map(o => o.tab.id)
          .join(',')}`
      );
    }

    function resolveTabPromise(tabDetails, timer, result) {
      gsUtils.log(
        tabDetails.tab.id,
        _queueId,
        'Queued tab resolved. Result: ',
        result
      );
      clearTimeout(timer);
      unqueueTab(tabDetails.tab);
      tabDetails.deferredPromise.resolve(result);
      processQueue();
    }

    function rejectTabPromise(tabDetails, timer, error) {
      gsUtils.log(
        tabDetails.tab.id,
        _queueId,
        'Queued tab rejected. Error: ',
        error
      );
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
        _queueProperties.exceptionFn(
          tabDetails.tab,
          tabDetails.executionProps,
          EXCEPTION_MAX_REQUEUES,
          resolve,
          reject,
          () => reject('Cannot requeue once max requeues has been reached')
        );
        return;
      }

      tabDetails.requeues += 1;
      tabDetails.status = STATUS_SLEEPING;
      gsUtils.log(
        tabDetails.tab.id,
        _queueId,
        `Requeueing tab. Requeues: ${tabDetails.requeues}`
      );
      processQueue();

      window.setTimeout(() => {
        tabDetails.status = STATUS_QUEUED;
        requestProcessQueue();
      }, requeueDelay);
    }

    return {
      EXCEPTION_TIMEOUT,
      EXCEPTION_MAX_REQUEUES,

      setQueueProperties,
      getQueueProperties,
      getTotalQueueSize,
      queueTabAsPromise,
      unqueueTab,
      getQueuedTabDetails,
    };
  })();
}
