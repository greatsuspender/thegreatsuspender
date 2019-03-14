/*global chrome, GsTabQueue, gsUtils, assertTrue */
var testSuites = typeof testSuites === 'undefined' ? [] : testSuites;
testSuites.push(
  (function() {
    'use strict';

    const MAX_REQUEUES = 2;

    function buildExecutorResolveTrue(executorDelay) {
      return async (tab, executionProps, resolve, reject, requeue) => {
        await gsUtils.setTimeout(executorDelay);
        resolve(true);
      };
    }

    function buildExecutorRequeue(executorDelay, requeueDelay) {
      return async (tab, executionProps, resolve, reject, requeue) => {
        executionProps.requeues = executionProps.requeues || 0;
        await gsUtils.setTimeout(executorDelay);
        if (executionProps.requeues !== MAX_REQUEUES) {
          executionProps.requeues += 1;
          requeue(requeueDelay);
        } else {
          resolve(true);
        }
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
      requeueDelay,
      concurrentExecutors,
      jobTimeout,
      executorFnType,
      exceptionFnType,
      shouldGenerateException,
      expectedTimeTaken
    ) {
      let executorFn;
      if (executorFnType === 'resolveTrue') {
        executorFn = buildExecutorResolveTrue(executorDelay);
      } else if (executorFnType === 'requeue') {
        executorFn = buildExecutorRequeue(executorDelay, requeueDelay);
      }
      let exceptionFn;
      if (exceptionFnType === 'resolveFalse') {
        exceptionFn = buildExceptionResolvesFalse();
      } else if (exceptionFnType === 'reject') {
        exceptionFn = buildExceptionRejects();
      }
      const queueProps = {
        concurrentExecutors,
        jobTimeout,
        executorFn,
        exceptionFn,
        processingDelay: 0,
      };

      const startTime = Date.now();
      const gsTabQueue = GsTabQueue('testQueue', queueProps);
      const results = await runQueueTest(tabCount, gsTabQueue);
      const timeTaken = Date.now() - startTime;
      console.log(
        `timers. timeTaken: ${timeTaken}. expected: ${expectedTimeTaken}`
      );

      let isResultsValid = false;
      if (shouldGenerateException && exceptionFnType === 'resolveFalse') {
        isResultsValid =
          results.length === tabCount && results.every(o => o === false);
      } else if (shouldGenerateException && exceptionFnType === 'reject') {
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
        // Test: 5 tabs. 100ms per tab. No requeue delay. 1 at a time. 1000ms timeout.
        // Executor function resolvesTrue. Exception function resolvesFalse.
        // Should resolveTrue.
        // Expected time taken: 5 * 100 + 5 * 50
        return await makeTest(
          5,
          100,
          0,
          1,
          1000,
          'resolveTrue',
          'resolveFalse',
          false,
          750
        );
      },

      async () => {
        // Test: 5 tabs. 100ms per tab. No requeue delay. 2 at a time. 1000ms timeout.
        // Executor function resolvesTrue. Exception function resolvesFalse.
        // Should resolveTrue.
        // Expected time taken: 3 * 100 + 3 * 50
        return await makeTest(
          5,
          100,
          0,
          2,
          1000,
          'resolveTrue',
          'resolveFalse',
          false,
          450
        );
      },

      async () => {
        // Test: 5 tabs. 100ms per tab. No requeue delay. 50 at a time. 1000ms timeout.
        // Executor function resolvesTrue. Exception function resolvesFalse.
        // Should resolveTrue.
        // Expected time taken: 1 * 100 + 1 * 50
        return await makeTest(
          5,
          100,
          0,
          50,
          1000,
          'resolveTrue',
          'resolveFalse',
          false,
          150
        );
      },

      async () => {
        // Test: 50 tabs. 100ms per tab. No requeue delay. 20 at a time. 1000ms timeout.
        // Executor function resolvesTrue. Exception function resolvesFalse.
        // Should resolveTrue.
        // Expected time taken: 3 * 100 + 3 * 50
        return await makeTest(
          50,
          100,
          0,
          20,
          1000,
          'resolveTrue',
          'resolveFalse',
          false,
          450
        );
      },

      async () => {
        // Test: 5 tabs. 100ms per tab. No requeue delay. 1 at a time. 10ms timeout.
        // Executor function resolvesTrue. Exception function resolvesFalse.
        // Should timeout on each execution.
        // Should resolveFalse.
        // Expected time taken: 5 * 10 + 5 * 50
        return await makeTest(
          5,
          100,
          0,
          1,
          10,
          'resolveTrue',
          'resolveFalse',
          true,
          300
        );
      },

      async () => {
        // Test: 5 tabs. 100ms per tab. No requeue delay. 1 at a time. 10ms timeout.
        // Executor function resolvesTrue. Exception function rejects.
        // Results should be undefined as Promises.all rejects.
        // Should reject.
        // Expected time taken: 5 * 10 + 5 * 50
        return await makeTest(5, 100, 0, 1, 10, 'resolveTrue', 'reject', true, 300);
      },

      async () => {
        // Test: 1 tab. 100ms per tab. 100ms requeue delay, 1 at a time. 1000ms timeout.
        // Executor function requeues (up to 2 times).
        // Exception function resolvesFalse.
        // Should requeue 2 times then resolveTrue.
        // Expected time taken: 3 * 1 * 100 + 3 * 100 + 1 * 50
        return await makeTest(
          1,
          100,
          100,
          1,
          1000,
          'requeue',
          'resolveFalse',
          false,
          650
        );
      },

      async () => {
        // Test: 1 tab. 100ms per tab. 100ms requeue delay, 1 at a time. 250ms timeout.
        // Executor function requeues (up to 2 times).
        // Exception function resolvesFalse.
        // Should requeue up to 2 times then timeout.
        // Expected time taken: 1 * 250 + 1 * 50
        return await makeTest(
          1,
          100,
          100,
          1,
          250,
          'requeue',
          'resolveFalse',
          true,
          300
        );
      },

      async () => {
        // Test: 1 tab. 100ms per tab. 100ms requeue delay. 1 at a time. 250ms timeout.
        // Executor function requeues (up to 2 times).
        // Exception function rejects.
        // Should requeue up to 2 times then timeout.
        // Expected time taken: 1 * 250 + 1 * 50
        return await makeTest(1, 100, 100, 1, 250, 'requeue', 'reject', true, 300);
      },
    ];

    return {
      name: 'gsTabQueue Library',
      tests,
    };
  })()
);
