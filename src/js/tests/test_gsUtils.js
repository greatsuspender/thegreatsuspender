/*global chrome, gsUtils, assertTrue */
var testSuites = typeof testSuites === 'undefined' ? [] : testSuites;
testSuites.push(
  (function() {
    'use strict';

    const tests = [
      // Test gsUtils.setTimeout
      async () => {
        const timeout = 500;
        const timeBefore = new Date().getTime();
        await gsUtils.setTimeout(timeout);
        const timeAfter = new Date().getTime();
        const isTimeAfterValid =
          timeAfter > timeBefore + timeout &&
          timeAfter < timeBefore + timeout + 200;

        return assertTrue(isTimeAfterValid);
      },
    ];

    return {
      name: 'gsUtils Library',
      tests,
    };
  })()
);
