/*global gsUtils, gsChrome, gsTabState */
// eslint-disable-next-line no-unused-vars
function GsTabQueue(initQueueId, initQueueProps) {
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
    const _queuedTabStates = [];
    let _processingQueueBufferTimer = null;
    let _queueId = initQueueId;

    setQueueProperties(initQueueProps);

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
      return _queuedTabStates.length;
    }

    function queueTabAsPromise(tab, executionProps, delay) {
      let queueState = getTabQueueState(tab);
      if (!queueState) {
        queueState = addTabToQueue(tab, executionProps);
        gsUtils.log(tab.id, _queueId, 'Queueing new tab.');
      } else {
        applyExecutionProps(queueState, executionProps);
        gsUtils.log(tab.id, _queueId, 'Tab already queued.');
      }

      if (delay && isValidInteger(delay, 1)) {
        gsUtils.log(tab.id, _queueId, `Sleeping tab for ${delay}ms`);
        sleepTab(queueState, delay);
      } else {
        // If tab is already marked as sleeping then wake it up
        if (queueState.sleepTimer) {
          gsUtils.log(tab.id, _queueId, 'Removing tab from sleep');
          clearTimeout(queueState.sleepTimer);
          delete queueState.sleepTimer;
          queueState.queueStatus = STATUS_QUEUED;
        }
        requestProcessQueue(0);
      }
      return queueState.deferredPromise;
    }

    function applyExecutionProps(queueState, executionProps) {
      executionProps = executionProps || {};
      for (const prop in executionProps) {
        queueState.executionProps[prop] = executionProps[prop];
      }
    }

    function unqueueTab(tab) {
      const tabState = gsTabState.getTabStateForId(tab.id);
      const queueState = getTabQueueState(tab);
      if (queueState) {
        // gsUtils.log(tab.id, _queueId, 'Unqueueing tab.');
        clearTimeout(queueState.timeoutTimer);
        removeTabStateFromQueue(tabState);
        rejectTabStatePromise(tabState, 'Queued tab job cancelled externally');
        return true;
      } else {
        return false;
      }
    }

    function getTabQueueState(tab) {
      const tabState = gsTabState.getTabStateForId(tab.id);
console.log(`tabState.queue[${_queueId}]`, tabState.queue[_queueId]);
      return tabState.queue[_queueId];
    }

    function setTabQueueState(tab, queueState) {
      const tabState = gsTabState.getTabStateForId(tab.id);
      tabState.queue[_queueId] = queueState;
    };

    function addTabToQueue(tab, executionProps) {
      const queueState = {
        executionProps,
        deferredPromise: createDeferredPromise(),
        queueStatus: STATUS_QUEUED,
        requeues: 0,
        sleepTimer: null,
      };
      setTabQueueState(tab, queueState);
      const tabState = gsTabState.getTabStateForId(tab.id);
console.log(_queueId, `adding tabState to queue. TabId: ${tab.id}. TabStateId: ${tabState.tab.id}`);
      _queuedTabStates.push(tabState);
console.log(_queueId, `postadd processQueue ids: ${_queuedTabStates.map(o => o.tab.id)}`);
      return queueState;
    }

    function removeTabStateFromQueue(tabState) {
console.log(_queueId, `pre processQueue ids: ${_queuedTabStates.map(o => o.tab.id)}`);
      for (const [i, currentTabState] of _queuedTabStates.entries()) {
        if (tabState === currentTabState) {
          _queuedTabStates.splice(i, 1);
          setTabQueueState(tabState.tab, null);
console.log(`removed tabState from queue[${_queueId}] for tabId: ${tabState.tab.id}`);
          break;
        }
      }
console.log(_queueId, `post processQueue ids: ${_queuedTabStates.map(o => o.tab.id)}`);
      gsUtils.log(_queueId, `total queue size: ${_queuedTabStates.length}`);
    }

    // eslint-disable-next-line no-unused-vars
    function moveTabToEndOfQueue(tabState) {
      for (const [i, currentTabState] of _queuedTabStates.entries()) {
        if (tabState === currentTabState) {
          _queuedTabStates.push(_queuedTabStates.splice(i, 1)[0]);
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
console.log(_queueId, `current processQueue ids: ${_queuedTabStates.map(o => o.tab.id)}`);
      for (const tabState of _queuedTabStates) {
console.log('processQueue: tabId: ' + tabState.tab.id);
        const queueState = getTabQueueState(tabState.tab);
        if (queueState.queueStatus === STATUS_IN_PROGRESS) {
          inProgressCount += 1;
        } else if (queueState.queueStatus === STATUS_QUEUED) {
          await processTabState(tabState);
          inProgressCount += 1;
        } else if (queueState.queueStatus === STATUS_SLEEPING) {
          // ignore
        }
        if (inProgressCount >= _queueProperties.concurrentExecutors) {
          break;
        }
      }
    }

    async function processTabState(tabState) {
      const queueState = getTabQueueState(tabState.tab);
      queueState.queueStatus = STATUS_IN_PROGRESS;
      gsUtils.log(
        tabState.tab.id,
        _queueId,
        'Executing executorFn for tab.'
        // tabState
      );

      if (tabState.refetchTab) {
        gsUtils.log(
          tabState.tab.id,
          _queueId,
          'Tab refetch requested. Getting updated tab..'
        );
        const updatedTab = await gsChrome.tabsGet(tabState.tab.id);
        tabState.refetchTab = false;
        if (!updatedTab) {
          gsUtils.warning(
            tabState.tab.id,
            _queueId,
            `Failed to fetch updated tab. Will remove from queue`
          );
          rejectTabStatePromise(
            tabState,
            `Tab with id: ${
              tabState.tab.id
            } does not exist. Tab may have been discarded or removed.`
          );
          return;
        }
      }

      const _resolveTabStatePromise = r => resolveTabStatePromise(tabState, r);
      const _rejectTabStatePromise = e => rejectTabStatePromise(tabState, e);
      const _requeueTabState = (requeueDelay, executionProps) => {
        requeueTabState(tabState, requeueDelay, executionProps);
      };

      // If timeout timer has not yet been initiated, then start it now
      if (!queueState.hasOwnProperty('timeoutTimer')) {
        queueState.timeoutTimer = setTimeout(() => {
          gsUtils.log(tabState.tab.id, _queueId, 'Tab job timed out');
          _queueProperties.exceptionFn(
            tabState.tab,
            queueState.executionProps,
            EXCEPTION_TIMEOUT,
            _resolveTabStatePromise,
            _rejectTabStatePromise,
            _requeueTabState
          ); //async. unhandled promise
        }, _queueProperties.jobTimeout);
      }

      _queueProperties.executorFn(
        tabState.tab,
        queueState.executionProps,
        _resolveTabStatePromise,
        _rejectTabStatePromise,
        _requeueTabState
      ); //async. unhandled promise
    }

    function resolveTabStatePromise(tabState, result) {
      const queueState = getTabQueueState(tabState.tab);
      if (!queueState) {
        return;
      }
      gsUtils.log(
        tabState.tab.id,
        _queueId,
        'Queued tab resolved. Result: ',
        result
      );
      clearTimeout(queueState.timeoutTimer);
      removeTabStateFromQueue(tabState);
      queueState.deferredPromise.resolve(result);
      requestProcessQueue(_queueProperties.processingDelay);
    }

    function rejectTabStatePromise(tabState, error) {
      const queueState = getTabQueueState(tabState.tab);
      if (!queueState) {
        return;
      }
      gsUtils.log(
        tabState.tab.id,
        _queueId,
        'Queued tab rejected. Error: ',
        error
      );
      clearTimeout(queueState.timeoutTimer);
      removeTabStateFromQueue(tabState);
      queueState.deferredPromise.reject(error);
      requestProcessQueue(_queueProperties.processingDelay);
    }

    function requeueTabState(tabState, requeueDelay, executionProps) {
      const queueState = getTabQueueState(tabState.tab);
      requeueDelay = requeueDelay || DEFAULT_REQUEUE_DELAY;
      if (executionProps) {
        applyExecutionProps(queueState, executionProps);
      }
      queueState.requeues += 1;
      gsUtils.log(
        tabState.tab.id,
        _queueId,
        `Requeueing tab. Requeues: ${queueState.requeues}`
      );
      // moveTabToEndOfQueue(tabState);
      sleepTab(queueState, requeueDelay);
      requestProcessQueue(_queueProperties.processingDelay);
    }

    function sleepTab(queueState, delay) {
      queueState.queueStatus = STATUS_SLEEPING;
      if (queueState.sleepTimer) {
        clearTimeout(queueState.sleepTimer);
      }
      queueState.sleepTimer = window.setTimeout(() => {
        delete queueState.sleepTimer;
        queueState.queueStatus = STATUS_QUEUED;
        requestProcessQueue(0);
      }, delay);
    }

    return {
      EXCEPTION_TIMEOUT,
      setQueueProperties,
      getQueueProperties,
      getTotalQueueSize,
      queueTabAsPromise,
      getTabQueueState,
      unqueueTab,
    };
  })();
}
