/**
 * @license Copyright 2017 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

const ThirdPartySummary = require('../../audits/third-party-summary.js');
const networkRecordsToDevtoolsLog = require('../network-records-to-devtools-log.js');

const pwaTrace = require('../fixtures/traces/progressive-app-m60.json');
const pwaDevtoolsLog = require('../fixtures/traces/progressive-app-m60.devtools.log.json');
const noThirdPartyTrace = require('../fixtures/traces/no-tracingstarted-m74.json');

/* eslint-env jest */
describe('Third party summary', () => {
  it('surface the discovered third parties', async () => {
    const artifacts = {
      devtoolsLogs: {defaultPass: pwaDevtoolsLog},
      traces: {defaultPass: pwaTrace},
    };

    const results = await ThirdPartySummary.audit(artifacts, {computedCache: new Map()});

    expect(results.score).toBe(1);
    expect(results.displayValue).toBeDisplayString(
      'Third-party code blocked the main thread for 20 ms'
    );
    expect(results.details.items).toEqual([
      {
        entity: {
          text: 'Google Tag Manager',
          type: 'link',
          url: 'https://marketingplatform.google.com/about/tag-manager/',
        },
        mainThreadTime: 104.70300000000002,
        blockingTime: 18.186999999999998,
        transferSize: 30827,
      },
      {
        entity: {
          text: 'Google Analytics',
          type: 'link',
          url: 'https://www.google.com/analytics/analytics/',
        },
        mainThreadTime: 87.576,
        blockingTime: 0,
        transferSize: 20913,
      },
    ]);
  });

  it('account for simulated throttling', async () => {
    const artifacts = {
      devtoolsLogs: {defaultPass: pwaDevtoolsLog},
      traces: {defaultPass: pwaTrace},
    };

    const settings = {throttlingMethod: 'simulate', throttling: {cpuSlowdownMultiplier: 4}};
    const results = await ThirdPartySummary.audit(artifacts, {computedCache: new Map(), settings});

    expect(results.score).toBe(0);
    expect(results.details.items).toHaveLength(2);
    expect(Math.round(results.details.items[0].mainThreadTime)).toEqual(419);
    expect(Math.round(results.details.items[0].blockingTime)).toEqual(250);
    expect(Math.round(results.details.items[1].mainThreadTime)).toEqual(350);
    expect(Math.round(results.details.items[1].blockingTime)).toEqual(157);
  });

  it('be not applicable when no third parties are present', async () => {
    const artifacts = {
      devtoolsLogs: {defaultPass: networkRecordsToDevtoolsLog([{url: 'chrome://version'}])},
      traces: {defaultPass: noThirdPartyTrace},
    };

    const settings = {throttlingMethod: 'simulate', throttling: {cpuSlowdownMultiplier: 4}};
    const results = await ThirdPartySummary.audit(artifacts, {computedCache: new Map(), settings});

    expect(results).toEqual({
      score: 1,
      notApplicable: true,
    });
  });
});
