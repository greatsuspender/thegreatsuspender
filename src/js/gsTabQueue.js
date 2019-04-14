/*global gsUtils, gsTabState */
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
      return _queuedTabIds.length;
    }

    function queueTabAsPromise(tab, executionProps, delay) {
      const tabState = gsTabState.getTabStateForId(tab.id);
      tabState.tab = tab;
      if (!tabState.queueProps) {
        // gsUtils.log(tab.id, _queueId, 'Queueing new tab.');
        tabState.queueProps = {
          executionProps,
          deferredPromise: createDeferredPromise(),
          queueStatus: STATUS_QUEUED,
          requeues: 0,
          sleepTimer: null,
        };
        addTabToQueue(tabState);
      } else {
        applyExecutionProps(tabState, executionProps);
        gsUtils.log(tab.id, _queueId, 'Tab already queued.');
      }

      const queueProps = tabState.queueProps;

      if (delay && isValidInteger(delay, 1)) {
        gsUtils.log(tab.id, _queueId, `Sleeping tab for ${delay}ms`);
        sleepTab(tabState, delay);
      } else {
        // If tab is already marked as sleeping then wake it up
        if (queueProps.sleepTimer) {
          gsUtils.log(tab.id, _queueId, 'Removing tab from sleep');
          clearTimeout(queueProps.sleepTimer);
          delete queueProps.sleepTimer;
          queueProps.queueStatus = STATUS_QUEUED;
        }
        requestProcessQueue(0);
      }
      return queueProps.deferredPromise;
    }

    function applyExecutionProps(tabState, executionProps) {
      executionProps = executionProps || {};
      for (const prop in executionProps) {
        tabState.executionProps[prop] = executionProps[prop];
      }
    }

    function unqueueTab(tab) {
      const tabState = gsTabState.getTabStateForId(tab.id);
      if (tabState) {
        // gsUtils.log(tab.id, _queueId, 'Unqueueing tab.');
        clearTimeout(tabState.queueProps.timeoutTimer);
        removeTabFromQueue(tabState);
        rejectTabPromise(tabState, 'Queued tab job cancelled externally');
        return true;
      } else {
        return false;
      }
    }

    function addTabToQueue(tabState) {
      const tab = tabState.tab;
      _queuedTabIds.push(tab.id);
    }

    function removeTabFromQueue(tabState) {
      const tab = tabState.tab;
      for (const [i, tabId] of _queuedTabIds.entries()) {
        if (tabId === tab.id) {
          _queuedTabIds.splice(i, 1);
          break;
        }
      }
      gsUtils.log(_queueId, `total queue size: ${_queuedTabIds.length}`);
    }

    // eslint-disable-next-line no-unused-vars
    function moveTabToEndOfQueue(tabState) {
      const tab = tabState.tab;
      for (const [i, tabId] of _queuedTabIds.entries()) {
        if (tabId === tab.id) {
          _queuedTabIds.push(_queuedTabIds.splice(i, 1)[0]);
          break;
        }
      }
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
        _processingQueueBufferTimer = setTimeout(async () => {
          _processingQueueBufferTimer = null;
          await processQueue();
        }, PROCESSING_QUEUE_CHECK_INTERVAL);
      }
    }

    async function processQueue() {
      let inProgressCount = 0;
      for (const tabId of _queuedTabIds) {
        const tabState = gsTabState.getTabStateForId(tabId);
        if (tabState.queueProps.queueStatus === STATUS_IN_PROGRESS) {
          inProgressCount += 1;
        } else if (tabState.queueProps.queueStatus === STATUS_QUEUED) {
          await processTab(tabState);
          inProgressCount += 1;
        } else if (tabState.queueProps.queueStatus === STATUS_SLEEPING) {
          // ignore
        }
        if (inProgressCount >= _queueProperties.concurrentExecutors) {
          break;
        }
      }
    }

    async function processTab(tabState) {
      tabState.queueProps.queueStatus = STATUS_IN_PROGRESS;
      gsUtils.log(
        tabState.tab.id,
        _queueId,
        'Executing executorFn for tab.'
        // tabState
      );

      if (tabState.refetchTab) {
        gsUtils.log(
          tabState.tabId,
          _queueId,
          'Tab refetch requested. Getting updated tab..'
        );
        const updatedTab = await gsChrome.tabsGet(tabState.tabId);
        tabState.refetchTab = false;
        if (!updatedTab) {
          gsUtils.warning(
            tabState.tabId,
            _queueId,
            `Failed to fetch updated tab. Will remove from queue`
          );
          rejectTabPromise(tabState, `Tab with id: ${tabState.tabId} does not exist. Tab may have been discarded or removed.`)
          return;
      }

      const _resolveTabPromise = r => resolveTabPromise(tabState, r);
      const _rejectTabPromise = e => rejectTabPromise(tabState, e);
      const _requeueTab = (requeueDelay, executionProps) => {
        requeueTab(tabState, requeueDelay, executionProps);
      };

      // If timeout timer has not yet been initiated, then start it now
      if (!tabState.queueProps.hasOwnProperty('timeoutTimer')) {
        tabState.queueProps.timeoutTimer = setTimeout(() => {
          gsUtils.log(tabState.tab.id, _queueId, 'Tab job timed out');
          _queueProperties.exceptionFn(
            tabState.tab,
            tabState.executionProps,
            EXCEPTION_TIMEOUT,
            _resolveTabPromise,
            _rejectTabPromise,
            _requeueTab
          ); //async. unhandled promise
        }, _queueProperties.jobTimeout);
      }

      _queueProperties.executorFn(
        tabState.tab,
        tabState.executionProps,
        _resolveTabPromise,
        _rejectTabPromise,
        _requeueTab
      ); //async. unhandled promise
    }

    function resolveTabPromise(tabState, result) {
      if (!tabState.queueProps) {
        return;
      }
      gsUtils.log(
        tabState.tab.id,
        _queueId,
        'Queued tab resolved. Result: ',
        result
      );
      clearTimeout(tabState.queueProps.timeoutTimer);
      removeTabFromQueue(tabState);
      tabState.queueProps.deferredPromise.resolve(result);
      requestProcessQueue(_queueProperties.processingDelay);
    }

    function rejectTabPromise(tabState, error) {
      if (!tabState.queueProps) {
        return;
      }
      gsUtils.log(
        tabState.tab.id,
        _queueId,
        'Queued tab rejected. Error: ',
        error
      );
      clearTimeout(tabState.queueProps.timeoutTimer);
      removeTabFromQueue(tabState);
      tabState.queueProps.deferredPromise.reject(error);
      requestProcessQueue(_queueProperties.processingDelay);
    }

    function requeueTab(tabState, requeueDelay, executionProps) {
      requeueDelay = requeueDelay || DEFAULT_REQUEUE_DELAY;
      if (executionProps) {
        applyExecutionProps(tabState, executionProps);
      }
      tabState.queueProps.requeues += 1;
      gsUtils.log(
        tabState.tab.id,
        _queueId,
        `Requeueing tab. Requeues: ${tabState.queueProps.requeues}`
      );
      // moveTabToEndOfQueue(tabState);
      sleepTab(tabState, requeueDelay);
      requestProcessQueue(_queueProperties.processingDelay);
    }

    function sleepTab(tabState, delay) {
      tabState.queueProps.queueStatus = STATUS_SLEEPING;
      if (tabState.queueProps.sleepTimer) {
        clearTimeout(tabState.queueProps.sleepTimer);
      }
      tabState.queueProps.sleepTimer = window.setTimeout(() => {
        delete tabState.queueProps.sleepTimer;
        tabState.queueProps.queueStatus = STATUS_QUEUED;
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
    };
  })();
}
