/*global chrome, GsTabQueue, gsUtils, assertTrue */
var testSuites = typeof testSuites === 'undefined' ? [] : testSuites;
testSuites.push(
  (function() {
    'use strict';

    function buildExecutorResolveTrue(executorDelay) {
      return async (tab, executionProps, resolve, reject, requeue) => {
        await gsUtils.setTimeout(executorDelay);
        resolve(true);
      };
    }

    function buildExecutorRequeue(executorDelay, requeueDelay) {
      return async (tab, executionProps, resolve, reject, requeue) => {
        await gsUtils.setTimeout(executorDelay);
        requeue(requeueDelay);
      };
    }

    function buildExceptionResolvesFalse() {
      return (tab, executionProps, exceptionType, resolve, reject, requeue) => {
        resolve(false);
      };
    }
    function buildExceptionRejects() {
      return (tab, executionProps, exceptionType, resolve, reject, requeue) => {
        reject('Test error');
      };
    }

    // TODO: This function has issues
    // It does not take into account delays caused by gsTabQueue.PROCESSING_QUEUE_CHECK_INTERVAL
    // And it does not correctly calculate extraRequeueingTime if the tabCount is
    // greater than queueProps.concurrentExecutors
    function calculateExpectedTimeTaken(
      tabCount,
      executorDelay,
      queueProps,
      allowRequeueing,
      maxRequeueAttempts,
      requeueDelay
    ) {
      const requiredGroupRuns =
        parseInt(tabCount / queueProps.concurrentExecutors) +
        (tabCount % queueProps.concurrentExecutors > 0 ? 1 : 0);
      let extraRequeueingTime = 0;
      if (allowRequeueing) {
        extraRequeueingTime = Math.min(
          executorDelay * maxRequeueAttempts +
            requeueDelay * maxRequeueAttempts,
          queueProps.executorTimeout
        );
      }
      return (
        requiredGroupRuns *
          Math.min(executorDelay, queueProps.executorTimeout) +
        extraRequeueingTime
      );
    }

    async function runQueueTest(tabCount, gsTabQueue) {
      const tabCheckPromises = [];
      for (let tabId = 1; tabId <= tabCount; tabId += 1) {
        const tabCheckPromise = gsTabQueue.queueTabAsPromise({
          id: tabId,
        });
        tabCheckPromises.push(tabCheckPromise);
      }

      let results;
      try {
        results = await Promise.all(tabCheckPromises);
      } catch (e) {
        console.log('Error!', e);
      }

      // Wait for queue to finish
      while (gsTabQueue.getTotalQueueSize() > 0) {
        await gsUtils.setTimeout(10);
      }
      return results;
    }

    async function makeTest(
      tabCount,
      executorDelay,
      concurrentExecutors,
      executorTimeout,
      executorFnType,
      exceptionFnType,
      maxRequeueAttempts,
      requeueDelay
    ) {
      let allowRequeueing = false;
      let executorFn;
      if (executorFnType === 'resolveTrue') {
        executorFn = buildExecutorResolveTrue(executorDelay);
      } else if (executorFnType === 'requeue') {
        executorFn = buildExecutorRequeue(executorDelay, requeueDelay);
        allowRequeueing = true;
      }
      let exceptionFn;
      if (exceptionFnType === 'resolveFalse') {
        exceptionFn = buildExceptionResolvesFalse();
      } else if (exceptionFnType === 'reject') {
        exceptionFn = buildExceptionRejects();
      }
      const queueProps = {
        concurrentExecutors,
        executorTimeout,
        executorFn,
        exceptionFn,
      };
      if (maxRequeueAttempts) {
        queueProps.maxRequeueAttempts = maxRequeueAttempts;
      }
      const expectedTimeTaken = calculateExpectedTimeTaken(
        tabCount,
        executorDelay,
        queueProps,
        allowRequeueing,
        maxRequeueAttempts,
        requeueDelay
      );

      const startTime = Date.now();
      const gsTabQueue = GsTabQueue('testQueue', queueProps);
      const results = await runQueueTest(tabCount, gsTabQueue);
      const timeTaken = Date.now() - startTime;
      console.log(
        `timers. timeTaken: ${timeTaken}. expected: ${expectedTimeTaken}`
      );

      const willGenerateException =
        executorDelay > executorTimeout || executorFnType === 'requeue';
      let isResultsValid = false;
      if (willGenerateException && exceptionFnType === 'resolveFalse') {
        isResultsValid =
          results.length === tabCount && results.every(o => o === false);
      } else if (willGenerateException && exceptionFnType === 'reject') {
        isResultsValid = typeof results === 'undefined';
      } else {
        isResultsValid =
          results.length === tabCount && results.every(o => o === true);
      }

      // Nasty hack here
      const allowedTimingVariation = 150;

      let isTimeValid =
        timeTaken > expectedTimeTaken &&
        timeTaken < expectedTimeTaken + allowedTimingVariation;

      return assertTrue(isResultsValid && isTimeValid);
    }

    const tests = [
      async () => {
        // Test: 5 tabs. 100ms per tab. 1 at a time. 1000ms timeout.
        // Executor function resolvesTrue. Exception function resolvesFalse.
        return await makeTest(5, 100, 1, 1000, 'resolveTrue', 'resolveFalse');
      },

      async () => {
        // Test: 5 tabs. 100ms per tab. 2 at a time. 1000ms timeout.
        // Executor function resolvesTrue. Exception function resolvesFalse.
        return await makeTest(5, 100, 2, 1000, 'resolveTrue', 'resolveFalse');
      },

      async () => {
        // Test: 5 tabs. 100ms per tab. 50 at a time. 1000ms timeout.
        // Executor function resolvesTrue. Exception function resolvesFalse.
        return await makeTest(5, 100, 50, 1000, 'resolveTrue', 'resolveFalse');
      },

      async () => {
        // Test: 50 tabs. 100ms per tab. 20 at a time. 1000ms timeout.
        // Executor function resolvesTrue. Exception function resolvesFalse.
        return await makeTest(50, 100, 20, 1000, 'resolveTrue', 'resolveFalse');
      },

      async () => {
        // Test: 5 tabs. 100ms per tab. 1 at a time. 10ms timeout.
        // Executor function resolvesTrue. Exception function resolvesFalse.
        // Should timeout on each execution.
        return await makeTest(5, 100, 1, 10, 'resolveTrue', 'resolveFalse');
      },

      async () => {
        // Test: 5 tabs. 100ms per tab. 1 at a time. 1000ms timeout.
        // Executor function resolvesTrue. Exception function rejects.
        // Results should be undefined as Promises.all rejects.
        return await makeTest(5, 100, 1, 1000, 'resolveTrue', 'reject');
      },

      async () => {
        // Test: 1 tab. 100ms per tab. 1 at a time. 200ms timeout.
        // Executor function requeues. Exception function resolvesFalse.
        // Should requeue up to 3 time on each iteration. 100ms requeue delay.
        return await makeTest(
          1,
          100,
          1,
          1000,
          'requeue',
          'resolveFalse',
          3,
          100
        );
      },

      async () => {
        // Test: 1 tab. 100ms per tab. 1 at a time. 1000ms timeout.
        // Executor function requeues. Exception function rejects.
        // Should requeue up to 2 times on each iteration. 50ms requeue delay.
        return await makeTest(1, 100, 1, 1000, 'requeue', 'reject', 2, 50);
      },
    ];

    return {
      name: 'gsTabQueue Library',
      tests,
    };
  })()
);
