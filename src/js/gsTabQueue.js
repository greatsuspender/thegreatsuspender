/*global gsUtils */
// eslint-disable-next-line no-unused-vars
function GsTabQueue(queueId, queueProps) {
  return (function() {
    'use strict';

    const STATUS_QUEUED = 'queued';
    const STATUS_IN_PROGRESS = 'inProgress';
    const STATUS_SLEEPING = 'sleeping';

    const EXCEPTION_TIMEOUT = 'timeout';

    const DEFAULT_CONCURRENT_EXECUTORS = 1;
    const DEFAULT_JOB_TIMEOUT = 1000;
    const DEFAULT_PROCESSING_DELAY = 500;
    const DEFAULT_REQUEUE_DELAY = 5000;
    const PROCESSING_QUEUE_CHECK_INTERVAL = 50;

    const _queueProperties = {
      concurrentExecutors: DEFAULT_CONCURRENT_EXECUTORS,
      jobTimeout: DEFAULT_JOB_TIMEOUT,
      processingDelay: DEFAULT_PROCESSING_DELAY,
      executorFn: (tab, resolve, reject, requeue) => resolve(true),
      exceptionFn: (tab, resolve, reject, requeue) => resolve(false),
    };
    const _tabDetailsByTabId = {};
    const _queuedTabIds = [];
    let _processingQueueBufferTimer = null;
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
      if (!isValidInteger(_queueProperties.jobTimeout, 1)) {
        throw new Error('jobTimeout must be an integer greater than 0');
      }
      if (!isValidInteger(_queueProperties.processingDelay, 0)) {
        throw new Error('processingDelay must be an integer of at least 0');
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

    function queueTabAsPromise(tab, executionProps, delay) {
      executionProps = executionProps || {};
      let tabDetails = _tabDetailsByTabId[tab.id];
      if (!tabDetails) {
        // gsUtils.log(tab.id, _queueId, 'Queueing new tab.');
        tabDetails = {
          tab,
          executionProps,
          deferredPromise: createDeferredPromise(),
          status: STATUS_QUEUED,
          requeues: 0,
        };
        addTabToQueue(tabDetails);
      } else {
        tabDetails.tab = tab;
        applyExecutionProps(tabDetails, executionProps);
        gsUtils.log(tab.id, _queueId, 'Tab already queued.');
      }

      if (delay && isValidInteger(delay, 1)) {
        gsUtils.log(tab.id, _queueId, `Sleeping tab for ${delay}ms`);
        sleepTab(tabDetails, delay);
      } else {
        // If tab is already marked as sleeping then wake it up
        if (tabDetails.sleepTimer) {
          gsUtils.log(tab.id, _queueId, 'Removing tab from sleep');
          clearTimeout(tabDetails.sleepTimer);
          delete tabDetails.sleepTimer;
          tabDetails.status = STATUS_QUEUED;
        }
        requestProcessQueue(0);
      }
      return tabDetails.deferredPromise;
    }

    function applyExecutionProps(tabDetails, executionProps) {
      executionProps = executionProps || {};
      for (const prop in executionProps) {
        tabDetails.executionProps[prop] = executionProps[prop];
      }
    }

    function unqueueTab(tab) {
      const tabDetails = _tabDetailsByTabId[tab.id];
      if (tabDetails) {
        // gsUtils.log(tab.id, _queueId, 'Unqueueing tab.');
        clearTimeout(tabDetails.timeoutTimer);
        removeTabFromQueue(tabDetails);
        rejectTabPromise(tabDetails, 'Queued tab job cancelled externally');
        return true;
      } else {
        return false;
      }
    }

    function addTabToQueue(tabDetails) {
      const tab = tabDetails.tab;
      _tabDetailsByTabId[tab.id] = tabDetails;
      _queuedTabIds.push(tab.id);
    }

    function removeTabFromQueue(tabDetails) {
      const tab = tabDetails.tab;
      delete _tabDetailsByTabId[tab.id];
      for (const [i, tabId] of _queuedTabIds.entries()) {
        if (tabId === tab.id) {
          _queuedTabIds.splice(i, 1);
          break;
        }
      }
      gsUtils.log(_queueId, `total queue size: ${_queuedTabIds.length}`);
    }

    // eslint-disable-next-line no-unused-vars
    function moveTabToEndOfQueue(tabDetails) {
      const tab = tabDetails.tab;
      for (const [i, tabId] of _queuedTabIds.entries()) {
        if (tabId === tab.id) {
          _queuedTabIds.push(_queuedTabIds.splice(i, 1)[0]);
          break;
        }
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

    function requestProcessQueue(processingDelay) {
      setTimeout(() => {
        startProcessQueueBufferTimer();
      }, processingDelay);
    }

    function startProcessQueueBufferTimer() {
      if (_processingQueueBufferTimer === null) {
        _processingQueueBufferTimer = setTimeout(() => {
          _processingQueueBufferTimer = null;
          processQueue();
        }, PROCESSING_QUEUE_CHECK_INTERVAL);
      }
    }

    function processQueue() {
      let inProgressCount = 0;
      for (const tabId of _queuedTabIds) {
        const tabDetails = _tabDetailsByTabId[tabId];
        if (tabDetails.status === STATUS_IN_PROGRESS) {
          inProgressCount += 1;
        } else if (tabDetails.status === STATUS_QUEUED) {
          processTab(tabDetails);
          inProgressCount += 1;
        } else if (tabDetails.status === STATUS_SLEEPING) {
          // ignore
        }
        if (inProgressCount >= _queueProperties.concurrentExecutors) {
          break;
        }
      }
    }

    function processTab(tabDetails) {
      tabDetails.status = STATUS_IN_PROGRESS;
      gsUtils.log(
        tabDetails.tab.id,
        _queueId,
        'Executing executorFn for tab.'
        // tabDetails
      );

      const _resolveTabPromise = r => resolveTabPromise(tabDetails, r);
      const _rejectTabPromise = e => rejectTabPromise(tabDetails, e);
      const _requeueTab = (requeueDelay, executionProps) => {
        requeueTab(tabDetails, requeueDelay, executionProps);
      };

      // If timeout timer has not yet been initiated, then start it now
      if (!tabDetails.hasOwnProperty('timeoutTimer')) {
        tabDetails.timeoutTimer = setTimeout(() => {
          gsUtils.log(tabDetails.tab.id, _queueId, 'Tab job timed out');
          _queueProperties.exceptionFn(
            tabDetails.tab,
            tabDetails.executionProps,
            EXCEPTION_TIMEOUT,
            _resolveTabPromise,
            _rejectTabPromise,
            _requeueTab
          ); //async. unhandled promise
        }, _queueProperties.jobTimeout);
      }

      _queueProperties.executorFn(
        tabDetails.tab,
        tabDetails.executionProps,
        _resolveTabPromise,
        _rejectTabPromise,
        _requeueTab
      ); //async. unhandled promise
    }

    function resolveTabPromise(tabDetails, result) {
      if (!_tabDetailsByTabId[tabDetails.tab.id]) {
        return;
      }
      gsUtils.log(
        tabDetails.tab.id,
        _queueId,
        'Queued tab resolved. Result: ',
        result
      );
      clearTimeout(tabDetails.timeoutTimer);
      removeTabFromQueue(tabDetails);
      tabDetails.deferredPromise.resolve(result);
      requestProcessQueue(_queueProperties.processingDelay);
    }

    function rejectTabPromise(tabDetails, error) {
      if (!_tabDetailsByTabId[tabDetails.tab.id]) {
        return;
      }
      gsUtils.log(
        tabDetails.tab.id,
        _queueId,
        'Queued tab rejected. Error: ',
        error
      );
      clearTimeout(tabDetails.timeoutTimer);
      removeTabFromQueue(tabDetails);
      tabDetails.deferredPromise.reject(error);
      requestProcessQueue(_queueProperties.processingDelay);
    }

    function requeueTab(tabDetails, requeueDelay, executionProps) {
      requeueDelay = requeueDelay || DEFAULT_REQUEUE_DELAY;
      if (executionProps) {
        applyExecutionProps(tabDetails, executionProps);
      }
      tabDetails.requeues += 1;
      gsUtils.log(
        tabDetails.tab.id,
        _queueId,
        `Requeueing tab. Requeues: ${tabDetails.requeues}`
      );
      // moveTabToEndOfQueue(tabDetails);
      sleepTab(tabDetails, requeueDelay);
      requestProcessQueue(_queueProperties.processingDelay);
    }

    function sleepTab(tabDetails, delay) {
      tabDetails.status = STATUS_SLEEPING;
      if (tabDetails.sleepTimer) {
        clearTimeout(tabDetails.sleepTimer);
      }
      tabDetails.sleepTimer = window.setTimeout(() => {
        delete tabDetails.sleepTimer;
        tabDetails.status = STATUS_QUEUED;
        requestProcessQueue(0);
      }, delay);
    }

    return {
      EXCEPTION_TIMEOUT,
      setQueueProperties,
      getQueueProperties,
      getTotalQueueSize,
      queueTabAsPromise,
      unqueueTab,
      getQueuedTabDetails,
    };
  })();
}
