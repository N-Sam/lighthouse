/**
 * @license Copyright 2016 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

/**
 * @fileoverview An end-to-end test runner for Lighthouse. Takes a set of smoke
 * test definitions and a method of running Lighthouse, returns whether all the
 * smoke tests passed.
 */

const log = require('lighthouse-logger');
const cliLighthouseRunner = require('./lighthouse-runners/cli.js').runLighthouse;
const getAssertionReport = require('./report-assert.js');
const LocalConsole = require('./lib/local-console.js');
const ConcurrentMapper = require('./lib/concurrent-mapper.js');

/* eslint-disable no-console */

/** @typedef {import('./lib/child-process-error.js')} ChildProcessError */

// The number of concurrent (`!runSerially`) tests to run if `jobs` isn't set.
const DEFAULT_CONCURRENT_RUNS = 5;
const DEFAULT_RETRIES = 0;

/**
 * @typedef SmokehouseOptions
 * @property {boolean=} isDebug If true, performs extra logging from the test runs.
 * @property {number=} jobs Manually set the number of jobs to run at once. `1` runs all tests serially.
 * @property {number=} retries The number of times to retry failing tests before accepting. Defaults to 0.
 * @property {LighthouseRunner=} lighthouseRunner A function that runs Lighthouse with the given options. Defaults to running Lighthouse via the CLI.
 */

/**
 * @callback LighthouseRunner
 * @param {string} url
 * @param {LH.Config.Json=} configJson
 * @param {{isDebug?: boolean}=} runnerOptions
 * @return {Promise<{lhr: LH.Result, artifacts: LH.Artifacts, log: string}>}
 */

/**
 * Runs the selected smoke tests. Returns whether all assertions pass.
 * @param {Array<Smokehouse.TestDfn>} smokeTestDefns
 * @param {SmokehouseOptions=} smokehouseOptions
 * @return {Promise<boolean>}
 */
async function runSmokehouse(smokeTestDefns, smokehouseOptions = {}) {
  const {
    isDebug,
    jobs = DEFAULT_CONCURRENT_RUNS,
    retries = DEFAULT_RETRIES,
    lighthouseRunner = cliLighthouseRunner,
  } = smokehouseOptions;
  assertPositiveInteger('jobs', jobs);
  assertNonNegativeInteger('retries', retries);

  // Run each testDefn's tests in parallel based on the concurrencyLimit.
  const concurrentMapper = new ConcurrentMapper();
  const smokePromises = [];
  for (const testDefn of smokeTestDefns) {
    // If defn is set to `runSerially`, we'll run its tests in succession, not parallel.
    const concurrency = testDefn.runSerially ? 1 : jobs;
    const options = {concurrency, lighthouseRunner, retries, isDebug};
    const result = runSmokeTestDefn(concurrentMapper, testDefn, options);
    smokePromises.push(result);
  }
  const smokeResults = await Promise.all(smokePromises);

  // Print and fail if there were failing tests.
  const failingDefns = smokeResults.filter(result => !result.success);
  if (failingDefns.length) {
    const testNames = failingDefns.map(d => d.id).join(', ');
    console.error(log.redify(`We have ${failingDefns.length} failing smoketests: ${testNames}`));
    return false;
  }

  return true;
}

/**
 * @param {string} loggableName
 * @param {number} value
 */
function assertPositiveInteger(loggableName, value) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${loggableName} must be a positive integer`);
  }
}
/**
 * @param {string} loggableName
 * @param {number} value
 */
function assertNonNegativeInteger(loggableName, value) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${loggableName} must be a non-negative integer`);
  }
}

/**
 * Run all the smoke tests specified, displaying output from each, in order,
 * once all are finished.
 * @param {ConcurrentMapper} concurrentMapper
 * @param {Smokehouse.TestDfn} smokeTestDefn
 * @param {{concurrency: number, retries: number, lighthouseRunner: LighthouseRunner, isDebug?: boolean}} defnOptions
 * @return {Promise<{id: string, success: boolean}>}
 */
async function runSmokeTestDefn(concurrentMapper, smokeTestDefn, defnOptions) {
  const {id, config: configJson, expectations} = smokeTestDefn;
  const {concurrency, lighthouseRunner, retries, isDebug} = defnOptions;

  const individualTests = expectations.map(expectation => ({
    requestedUrl: expectation.lhr.requestedUrl,
    configJson,
    expectation,
    lighthouseRunner,
    retries,
    isDebug,
  }));

  // Loop sequentially over expectations, comparing against Lighthouse run, and
  // reporting result.
  const results = await concurrentMapper.pooledMap(individualTests, (test, index) => {
    if (index === 0) console.log(`${purpleify(id)} smoketest starting…`);
    return runSmokeTest(test);
  }, {concurrency});

  console.log(`\n${purpleify(id)} smoketest results:`);

  let passingTestCount = 0;
  let failingTestCount = 0;
  for (const result of results) {
    if (result.failed) {
      failingTestCount++;
    } else {
      passingTestCount++;
    }

    process.stdout.write(result.log);
  }

  console.log(`${purpleify(id)} smoketest complete.`);
  if (passingTestCount) {
    console.log(log.greenify(`  ${passingTestCount} test(s) passing`));
  }
  if (failingTestCount) {
    console.log(log.redify(`  ${failingTestCount} test(s) failing`));
  }
  console.log(''); // extra line break

  return {
    id,
    success: failingTestCount === 0,
  };
}

/** @param {string} str */
function purpleify(str) {
  return `${log.purple}${str}${log.reset}`;
}

/**
 * Run Lighthouse in the selected runner. Returns `log`` for logging once
 * all tests in a defn are complete.
 * @param {{requestedUrl: string, configJson?: LH.Config.Json, expectation: Smokehouse.ExpectedRunnerResult, lighthouseRunner: LighthouseRunner, retries: number, isDebug?: boolean}} testOptions
 * @return {Promise<{passed: number, failed: number, log: string}>}
 */
async function runSmokeTest(testOptions) {
  // Use a buffered LocalConsole to keep logged output so it's not interleaved
  // with other currently running tests.
  const localConsole = new LocalConsole();
  const {requestedUrl, configJson, expectation, lighthouseRunner, retries, isDebug} = testOptions;

  // Rerun test until there's a passing result or retries are exhausted to prevent flakes.
  let result;
  let report;
  for (let i = 0; i <= retries; i++) {
    if (i === 0) {
      localConsole.log(`Doing a run of '${requestedUrl}'...`);
    } else {
      localConsole.log(`Retrying run (${i} out of ${retries} retries)...`);
    }

    // Run Lighthouse.
    try {
      result = await lighthouseRunner(requestedUrl, configJson, {isDebug});
    } catch (e) {
      logChildProcessError(localConsole, e);
      continue; // Retry, if possible.
    }

    // Assert result.
    report = getAssertionReport(result, expectation, {isDebug});
    if (report.failed) {
      localConsole.log(`${report.failed} assertion(s) failed.`);
      continue; // Retry, if possible.
    }

    break; // Passing result, no need to retry.
  }

  // Write result log if we have one.
  if (result) {
    localConsole.write(result.log);
  }

  // Without an assertion report, not much detail to share but a failure.
  if (!report) {
    return {
      passed: 0,
      failed: 1,
      log: localConsole.getLog(),
    };
  }

  localConsole.write(report.log);
  return {
    passed: report.passed,
    failed: report.failed,
    log: localConsole.getLog(),
  };
}

/**
 * Logs an error to the console, including stdout and stderr if `err` is a
 * `ChildProcessError`.
 * @param {LocalConsole} localConsole
 * @param {ChildProcessError|Error} err
 */
function logChildProcessError(localConsole, err) {
  if ('stdout' in err && 'stderr' in err) {
    localConsole.adoptStdStrings(err);
  }

  localConsole.log(log.redify('Error: ') + err.message);
}

module.exports = {
  runSmokehouse,
};
