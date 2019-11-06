/**
 * @license Copyright 2016 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

/* eslint-env jest */

const Gatherer = require('../../gather/gatherers/gatherer.js');
const GatherRunner = require('../../gather/gather-runner.js');
const assert = require('assert');
const Config = require('../../config/config.js');
const unresolvedPerfLog = require('./../fixtures/unresolved-perflog.json');
const NetworkRequest = require('../../lib/network-request.js');
const LHError = require('../../lib/lh-error.js');
const networkRecordsToDevtoolsLog = require('../network-records-to-devtools-log.js');

jest.mock('../../lib/stack-collector.js', () => () => Promise.resolve([]));

class TestGatherer extends Gatherer {
  constructor() {
    super();
    this.called = false;
  }

  pass() {
    this.called = true;
    return 'MyArtifact';
  }
}

class TestGathererNoArtifact extends Gatherer {
  beforePass() {}
  pass() {}
  afterPass() {}
}

const fakeDriver = require('./fake-driver.js');
const fakeDriverUsingRealMobileDevice = fakeDriver.fakeDriverUsingRealMobileDevice;

function getMockedEmulationDriver(emulationFn, netThrottleFn, cpuThrottleFn,
  blockUrlFn, extraHeadersFn) {
  const Driver = require('../../gather/driver.js');
  const Connection = require('../../gather/connections/connection.js');
  const EmulationDriver = class extends Driver {
    enableRuntimeEvents() {
      return Promise.resolve();
    }
    enableAsyncStacks() {
      return Promise.resolve();
    }
    assertNoSameOriginServiceWorkerClients() {
      return Promise.resolve();
    }
    cacheNatives() {
      return Promise.resolve();
    }
    registerPerformanceObserver() {
      return Promise.resolve();
    }
    cleanBrowserCaches() {}
    clearDataForOrigin() {}
  };
  const EmulationMock = class extends Connection {
    sendCommand(command, sessionId, params) {
      let fn = null;
      switch (command) {
        case 'Network.emulateNetworkConditions':
          fn = netThrottleFn;
          break;
        case 'Emulation.setCPUThrottlingRate':
          fn = cpuThrottleFn;
          break;
        case 'Emulation.setDeviceMetricsOverride':
          fn = emulationFn;
          break;
        case 'Network.setBlockedURLs':
          fn = blockUrlFn;
          break;
        case 'Network.setExtraHTTPHeaders':
          fn = extraHeadersFn;
          break;
        default:
          fn = null;
          break;
      }
      return Promise.resolve(fn && fn(params));
    }
  };
  return new EmulationDriver(new EmulationMock());
}

describe('GatherRunner', function() {
  it('loads a page and updates passContext.URL on redirect', () => {
    const url1 = 'https://example.com';
    const url2 = 'https://example.com/interstitial';
    const driver = {
      gotoURL() {
        return Promise.resolve(url2);
      },
    };

    const passContext = {
      url: url1,
      settings: {},
      passConfig: {
        gatherers: [],
      },
    };

    return GatherRunner.loadPage(driver, passContext).then(_ => {
      assert.equal(passContext.url, url2);
    });
  });

  it('loads a page and returns a pageLoadError', async () => {
    const url = 'https://example.com';
    const error = new LHError(LHError.errors.NO_FCP);
    const driver = {
      gotoURL() {
        return Promise.reject(error);
      },
    };

    const passContext = {
      url,
      settings: {},
      passConfig: {gatherers: []},
    };

    const {navigationError} = await GatherRunner.loadPage(driver, passContext);
    expect(navigationError).toEqual(error);
    expect(passContext.url).toEqual(url);
  });

  it('collects benchmark as an artifact', async () => {
    const requestedUrl = 'https://example.com';
    const driver = fakeDriver;
    const config = new Config({passes: []});
    const options = {requestedUrl, driver, settings: config.settings};

    const results = await GatherRunner.run(config.passes, options);
    expect(Number.isFinite(results.BenchmarkIndex)).toBeTruthy();
  });

  it('collects host user agent as an artifact', async () => {
    const requestedUrl = 'https://example.com';
    const driver = fakeDriver;
    const config = new Config({passes: []});
    const options = {requestedUrl, driver, settings: config.settings};

    const results = await GatherRunner.run(config.passes, options);
    expect(results.HostUserAgent).toEqual(fakeDriver.protocolGetVersionResponse.userAgent);
    expect(results.HostUserAgent).toMatch(/Chrome\/\d+/);
  });

  it('collects network user agent as an artifact', async () => {
    const requestedUrl = 'https://example.com';
    const driver = fakeDriver;
    const config = new Config({passes: [{}]});
    const options = {requestedUrl, driver, settings: config.settings};

    const results = await GatherRunner.run(config.passes, options);
    expect(results.NetworkUserAgent).toContain('Mozilla');
  });

  it('collects requested and final URLs as an artifact', () => {
    const requestedUrl = 'https://example.com';
    const finalUrl = 'https://example.com/interstitial';
    const driver = Object.assign({}, fakeDriver, {
      gotoURL() {
        return Promise.resolve(finalUrl);
      },
    });
    const config = new Config({passes: [{}]});
    const options = {requestedUrl, driver, settings: config.settings};

    return GatherRunner.run(config.passes, options).then(artifacts => {
      assert.deepStrictEqual(artifacts.URL, {requestedUrl, finalUrl},
        'did not find expected URL artifact');
    });
  });

  describe('collects TestedAsMobileDevice as an artifact', () => {
    const requestedUrl = 'https://example.com';

    it('works when running on desktop device without emulation', async () => {
      const driver = fakeDriver;
      const config = new Config({
        passes: [],
        settings: {emulatedFormFactor: 'none'},
      });
      const options = {requestedUrl, driver, settings: config.settings};

      const results = await GatherRunner.run(config.passes, options);
      expect(results.TestedAsMobileDevice).toBe(false);
    });

    it('works when running on desktop device with mobile emulation', async () => {
      const driver = fakeDriver;
      const config = new Config({
        passes: [],
        settings: {emulatedFormFactor: 'mobile'},
      });
      const options = {requestedUrl, driver, settings: config.settings};

      const results = await GatherRunner.run(config.passes, options);
      expect(results.TestedAsMobileDevice).toBe(true);
    });

    it('works when running on mobile device without emulation', async () => {
      const driver = fakeDriverUsingRealMobileDevice;
      const config = new Config({
        passes: [],
        settings: {emulatedFormFactor: 'none'},
      });
      const options = {requestedUrl, driver, settings: config.settings};

      const results = await GatherRunner.run(config.passes, options);
      expect(results.TestedAsMobileDevice).toBe(true);
    });

    it('works when running on mobile device with desktop emulation', async () => {
      const driver = fakeDriverUsingRealMobileDevice;
      const config = new Config({
        passes: [],
        settings: {emulatedFormFactor: 'desktop'},
      });
      const options = {requestedUrl, driver, settings: config.settings};

      const results = await GatherRunner.run(config.passes, options);
      expect(results.TestedAsMobileDevice).toBe(false);
    });
  });

  describe('collects HostFormFactor as an artifact', () => {
    const requestedUrl = 'https://example.com';

    function test(name, userAgent, expectedValue) {
      it(name, async () => {
        const driver = Object.assign({}, fakeDriver, {
          getBrowserVersion() {
            return Promise.resolve({userAgent: userAgent});
          },
        });
        const config = new Config({
          passes: [],
          settings: {},
        });
        const options = {requestedUrl, driver, settings: config.settings};

        const results = await GatherRunner.run(config.passes, options);
        expect(results.HostFormFactor).toBe(expectedValue);
      });
    }

    /* eslint-disable max-len */
    const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 7_1_2 like Mac OS X) AppleWebKit/537.51.2 (KHTML, like Gecko) OPiOS/10.2.0.93022 Mobile/11D257 Safari/9537.53';
    const ANDROID_UA = 'Mozilla/5.0 (Linux; U; Android 4.4.2; en-us; SCH-I535 Build/KOT49H) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30';
    const DESKTOP_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.87 Safari/537.36';
    /* eslint-enable max-len */

    test('works when running on mobile device', IOS_UA, 'mobile');
    test('works when running on android device', ANDROID_UA, 'mobile');
    test('works when running on desktop device', DESKTOP_UA, 'desktop');
  });

  it('sets up the driver to begin emulation when all emulation flags are undefined', () => {
    const tests = {
      calledDeviceEmulation: false,
      calledNetworkEmulation: false,
      calledCpuEmulation: false,
    };
    const createEmulationCheck = variable => (arg) => {
      tests[variable] = arg;

      return true;
    };
    const driver = getMockedEmulationDriver(
      createEmulationCheck('calledDeviceEmulation'),
      createEmulationCheck('calledNetworkEmulation'),
      createEmulationCheck('calledCpuEmulation')
    );

    return GatherRunner.setupDriver(driver, {
      settings: {emulatedFormFactor: 'mobile'},
    }).then(_ => {
      assert.ok(tests.calledDeviceEmulation, 'did not call device emulation');
      assert.deepEqual(tests.calledNetworkEmulation, {
        latency: 0, downloadThroughput: 0, uploadThroughput: 0, offline: false,
      });
      assert.ok(!tests.calledCpuEmulation, 'called cpu emulation');
    });
  });

  it('uses correct emulation form factor', async () => {
    let emulationParams;
    const driver = getMockedEmulationDriver(
      params => emulationParams = params,
      () => true,
      () => true
    );

    await GatherRunner.setupDriver(driver, {settings: {emulatedFormFactor: 'mobile'}});
    expect(emulationParams).toMatchObject({mobile: true});

    await GatherRunner.setupDriver(driver, {settings: {emulatedFormFactor: 'desktop'}});
    expect(emulationParams).toMatchObject({mobile: false});

    emulationParams = undefined;
    await GatherRunner.setupDriver(driver, {settings: {emulatedFormFactor: 'none'}});
    expect(emulationParams).toBe(undefined);
  });

  it('stops throttling when not devtools', () => {
    const tests = {
      calledDeviceEmulation: false,
      calledNetworkEmulation: false,
      calledCpuEmulation: false,
    };
    const createEmulationCheck = variable => (...args) => {
      tests[variable] = args;
      return true;
    };
    const driver = getMockedEmulationDriver(
      createEmulationCheck('calledDeviceEmulation'),
      createEmulationCheck('calledNetworkEmulation'),
      createEmulationCheck('calledCpuEmulation')
    );

    return GatherRunner.setupDriver(driver, {
      settings: {
        emulatedFormFactor: 'mobile',
        throttlingMethod: 'provided',
      },
    }).then(_ => {
      assert.ok(tests.calledDeviceEmulation, 'did not call device emulation');
      assert.deepEqual(tests.calledNetworkEmulation, [{
        latency: 0, downloadThroughput: 0, uploadThroughput: 0, offline: false,
      }]);
      assert.ok(!tests.calledCpuEmulation, 'called CPU emulation');
    });
  });

  it('sets throttling according to settings', () => {
    const tests = {
      calledDeviceEmulation: false,
      calledNetworkEmulation: false,
      calledCpuEmulation: false,
    };
    const createEmulationCheck = variable => (...args) => {
      tests[variable] = args;

      return true;
    };
    const driver = getMockedEmulationDriver(
      createEmulationCheck('calledDeviceEmulation'),
      createEmulationCheck('calledNetworkEmulation'),
      createEmulationCheck('calledCpuEmulation')
    );

    return GatherRunner.setupDriver(driver, {
      settings: {
        emulatedFormFactor: 'mobile',
        throttlingMethod: 'devtools',
        throttling: {
          requestLatencyMs: 100,
          downloadThroughputKbps: 8,
          uploadThroughputKbps: 8,
          cpuSlowdownMultiplier: 1,
        },
      },
    }).then(_ => {
      assert.ok(tests.calledDeviceEmulation, 'did not call device emulation');
      assert.deepEqual(tests.calledNetworkEmulation, [{
        latency: 100, downloadThroughput: 1024, uploadThroughput: 1024, offline: false,
      }]);
      assert.deepEqual(tests.calledCpuEmulation, [{rate: 1}]);
    });
  });

  it('clears origin storage', () => {
    const asyncFunc = () => Promise.resolve();
    const tests = {
      calledCleanBrowserCaches: false,
      calledClearStorage: false,
    };
    const createCheck = variable => () => {
      tests[variable] = true;
      return Promise.resolve();
    };
    const driver = {
      assertNoSameOriginServiceWorkerClients: asyncFunc,
      beginEmulation: asyncFunc,
      setThrottling: asyncFunc,
      dismissJavaScriptDialogs: asyncFunc,
      enableRuntimeEvents: asyncFunc,
      enableAsyncStacks: asyncFunc,
      cacheNatives: asyncFunc,
      gotoURL: asyncFunc,
      registerPerformanceObserver: asyncFunc,
      cleanBrowserCaches: createCheck('calledCleanBrowserCaches'),
      clearDataForOrigin: createCheck('calledClearStorage'),
      blockUrlPatterns: asyncFunc,
      setExtraHTTPHeaders: asyncFunc,
    };

    return GatherRunner.setupDriver(driver, {settings: {}}).then(_ => {
      assert.equal(tests.calledCleanBrowserCaches, false);
      assert.equal(tests.calledClearStorage, true);
    });
  });

  it('clears the disk & memory cache on a perf run', async () => {
    const asyncFunc = () => Promise.resolve();
    const tests = {
      calledCleanBrowserCaches: false,
    };
    const createCheck = variable => () => {
      tests[variable] = true;
      return Promise.resolve();
    };
    const driver = {
      beginDevtoolsLog: asyncFunc,
      beginTrace: asyncFunc,
      gotoURL: asyncFunc,
      cleanBrowserCaches: createCheck('calledCleanBrowserCaches'),
      setThrottling: asyncFunc,
      blockUrlPatterns: asyncFunc,
      setExtraHTTPHeaders: asyncFunc,
      endTrace: asyncFunc,
      endDevtoolsLog: () => [],
      getBrowserVersion: async () => ({userAgent: ''}),
      getScrollPosition: async () => 1,
      scrollTo: async () => {},
    };
    const passConfig = {
      passName: 'default',
      recordTrace: true,
      useThrottling: true,
      gatherers: [],
    };
    const settings = {
      disableStorageReset: false,
    };
    const requestedUrl = 'https://example.com';
    const passContext = {
      driver,
      passConfig,
      settings,
      baseArtifacts: await GatherRunner.initializeBaseArtifacts({driver, settings, requestedUrl}),
    };

    await GatherRunner.runPass(passContext);
    assert.equal(tests.calledCleanBrowserCaches, true);
  });

  it('returns a pageLoadError and no artifacts when there is a network error', async () => {
    const requestedUrl = 'https://example.com';
    // This page load error should be overriden by ERRORED_DOCUMENT_REQUEST (for being
    // more specific) since the main document network request failed with a 500.
    const navigationError = new LHError(LHError.errors.NO_FCP);
    const driver = Object.assign({}, fakeDriver, {
      online: true,
      gotoURL: url => url.includes('blank') ? null : Promise.reject(navigationError),
      endDevtoolsLog() {
        return networkRecordsToDevtoolsLog([{url: requestedUrl, statusCode: 500}]);
      },
    });

    const config = new Config({
      passes: [{
        recordTrace: true,
        passName: 'firstPass',
        gatherers: [{instance: new TestGatherer()}],
      }],
    });
    const options = {
      driver,
      requestedUrl,
      settings: config.settings,
    };

    const artifacts = await GatherRunner.run(config.passes, options);
    expect(artifacts.LighthouseRunWarnings).toHaveLength(1);
    expect(artifacts.PageLoadError).toBeInstanceOf(Error);
    expect(artifacts.PageLoadError.code).toEqual('ERRORED_DOCUMENT_REQUEST');
    expect(artifacts.TestGatherer).toBeUndefined();
  });

  it('returns a pageLoadError and no artifacts when there is a navigation error', async () => {
    const requestedUrl = 'https://example.com';
    // This time, NO_FCP should win because it's the only error left.
    const navigationError = new LHError(LHError.errors.NO_FCP);
    const driver = Object.assign({}, fakeDriver, {
      online: true,
      gotoURL: url => url.includes('blank') ? null : Promise.reject(navigationError),
      endDevtoolsLog() {
        return networkRecordsToDevtoolsLog([{url: requestedUrl}]);
      },
    });

    const config = new Config({
      passes: [{
        recordTrace: true,
        passName: 'firstPass',
        gatherers: [{instance: new TestGatherer()}],
      }],
    });
    const options = {
      driver,
      requestedUrl,
      settings: config.settings,
    };

    const artifacts = await GatherRunner.run(config.passes, options);
    expect(artifacts.LighthouseRunWarnings).toHaveLength(1);
    expect(artifacts.PageLoadError).toBeInstanceOf(Error);
    expect(artifacts.PageLoadError.code).toEqual('NO_FCP');
    expect(artifacts.TestGatherer).toBeUndefined();
  });

  it('does not clear origin storage with flag --disable-storage-reset', () => {
    const asyncFunc = () => Promise.resolve();
    const tests = {
      calledCleanBrowserCaches: false,
      calledClearStorage: false,
    };
    const createCheck = variable => () => {
      tests[variable] = true;
      return Promise.resolve();
    };
    const driver = {
      assertNoSameOriginServiceWorkerClients: asyncFunc,
      beginEmulation: asyncFunc,
      setThrottling: asyncFunc,
      dismissJavaScriptDialogs: asyncFunc,
      enableRuntimeEvents: asyncFunc,
      enableAsyncStacks: asyncFunc,
      cacheNatives: asyncFunc,
      gotoURL: asyncFunc,
      registerPerformanceObserver: asyncFunc,
      cleanBrowserCaches: createCheck('calledCleanBrowserCaches'),
      clearDataForOrigin: createCheck('calledClearStorage'),
      blockUrlPatterns: asyncFunc,
      setExtraHTTPHeaders: asyncFunc,
    };

    return GatherRunner.setupDriver(driver, {
      settings: {disableStorageReset: true},
    }).then(_ => {
      assert.equal(tests.calledCleanBrowserCaches, false);
      assert.equal(tests.calledClearStorage, false);
    });
  });

  it('tells the driver to block given URL patterns when blockedUrlPatterns is given', () => {
    let receivedUrlPatterns = null;
    const driver = getMockedEmulationDriver(null, null, null, params => {
      receivedUrlPatterns = params.urls;
    });

    return GatherRunner.setupPassNetwork({
      driver,
      settings: {
        blockedUrlPatterns: ['http://*.evil.com', '.jpg', '.woff2'],
      },
      passConfig: {
        blockedUrlPatterns: ['*.jpeg'],
        gatherers: [],
      },
    }).then(() => assert.deepStrictEqual(
      receivedUrlPatterns.sort(),
      ['*.jpeg', '.jpg', '.woff2', 'http://*.evil.com']
    ));
  });

  it('does not throw when blockedUrlPatterns is not given', () => {
    let receivedUrlPatterns = null;
    const driver = getMockedEmulationDriver(null, null, null, params => {
      receivedUrlPatterns = params.urls;
    });

    return GatherRunner.setupPassNetwork({
      driver,
      settings: {},
      passConfig: {gatherers: []},
    }).then(() => assert.deepStrictEqual(receivedUrlPatterns, []));
  });


  it('tells the driver to set additional http headers when extraHeaders flag is given', () => {
    let receivedHeaders = null;
    const driver = getMockedEmulationDriver(null, null, null, null, params => {
      receivedHeaders = params.headers;
    });
    const headers = {
      'Cookie': 'monster',
      'x-men': 'wolverine',
    };

    return GatherRunner.setupPassNetwork({
      driver,
      settings: {
        extraHeaders: headers,
      },
      passConfig: {gatherers: []},
    }).then(() => assert.deepStrictEqual(
        receivedHeaders,
        headers
      ));
  });

  it('tells the driver to begin tracing', async () => {
    let calledTrace = false;
    const driver = {
      beginTrace() {
        calledTrace = true;
        return Promise.resolve();
      },
      beginDevtoolsLog() {
        return Promise.resolve();
      },
    };

    const passConfig = {
      recordTrace: true,
      gatherers: [
        {instance: new TestGatherer()},
      ],
    };
    const settings = {};

    await GatherRunner.beginRecording({driver, passConfig, settings});
    assert.equal(calledTrace, true);
  });

  it('tells the driver to end tracing', () => {
    const url = 'https://example.com';
    let calledTrace = false;
    const fakeTraceData = {traceEvents: ['reallyBelievableTraceEvents']};

    const driver = Object.assign({}, fakeDriver, {
      endTrace() {
        calledTrace = true;
        return Promise.resolve(fakeTraceData);
      },
    });

    const passConfig = {
      recordTrace: true,
      gatherers: [
        {instance: new TestGatherer()},
      ],
    };

    return GatherRunner.endRecording({url, driver, passConfig}).then(passData => {
      assert.equal(calledTrace, true);
      assert.equal(passData.trace, fakeTraceData);
    });
  });

  it('tells the driver to begin devtoolsLog collection', async () => {
    let calledDevtoolsLogCollect = false;
    const driver = {
      beginDevtoolsLog() {
        calledDevtoolsLogCollect = true;
        return Promise.resolve();
      },
      gotoURL() {
        return Promise.resolve();
      },
    };

    const passConfig = {
      gatherers: [
        {instance: new TestGatherer()},
      ],
    };
    const settings = {};

    await GatherRunner.beginRecording({driver, passConfig, settings});
    assert.equal(calledDevtoolsLogCollect, true);
  });

  it('tells the driver to end devtoolsLog collection', () => {
    const url = 'https://example.com';
    let calledDevtoolsLogCollect = false;

    const fakeDevtoolsMessage = {method: 'Network.FakeThing', params: {}};
    const driver = Object.assign({}, fakeDriver, {
      endDevtoolsLog() {
        calledDevtoolsLogCollect = true;
        return [
          fakeDevtoolsMessage,
        ];
      },
    });

    const passConfig = {
      gatherers: [
        {instance: new TestGatherer()},
      ],
    };

    return GatherRunner.endRecording({url, driver, passConfig}).then(passData => {
      assert.equal(calledDevtoolsLogCollect, true);
      assert.strictEqual(passData.devtoolsLog[0], fakeDevtoolsMessage);
    });
  });

  it('resets scroll position between every gatherer', async () => {
    class ScrollMcScrollyGatherer extends TestGatherer {
      afterPass(context) {
        context.driver.scrollTo({x: 1000, y: 1000});
      }
    }

    const url = 'https://example.com';
    const driver = Object.assign({}, fakeDriver);
    const scrollToSpy = jest.spyOn(driver, 'scrollTo');

    const passConfig = {
      recordTrace: true,
      gatherers: [
        {instance: new ScrollMcScrollyGatherer()},
        {instance: new TestGatherer()},
      ],
    };

    await GatherRunner.afterPass({url, driver, passConfig}, {}, {TestGatherer: []});
    // One time for the afterPass of ScrollMcScrolly, two times for the resets of the two gatherers.
    expect(scrollToSpy.mock.calls).toEqual([
      [{x: 1000, y: 1000}],
      [{x: 0, y: 0}],
      [{x: 0, y: 0}],
    ]);
  });

  it('does as many passes as are required', () => {
    const t1 = new TestGatherer();
    const t2 = new TestGatherer();

    const config = new Config({
      passes: [{
        recordTrace: true,
        passName: 'firstPass',
        gatherers: [
          {instance: t1},
        ],
      }, {
        passName: 'secondPass',
        gatherers: [
          {instance: t2},
        ],
      }],
    });

    return GatherRunner.run(config.passes, {
      driver: fakeDriver,
      requestedUrl: 'https://example.com',
      settings: config.settings,
    }).then(_ => {
      assert.ok(t1.called);
      assert.ok(t2.called);
    });
  });

  it('respects trace names', () => {
    const config = new Config({
      passes: [{
        recordTrace: true,
        passName: 'firstPass',
        gatherers: [{instance: new TestGatherer()}],
      }, {
        recordTrace: true,
        passName: 'secondPass',
        gatherers: [{instance: new TestGatherer()}],
      }],
    });
    const options = {
      driver: fakeDriver,
      requestedUrl: 'https://example.com',
      settings: config.settings,
    };

    return GatherRunner.run(config.passes, options)
      .then(artifacts => {
        assert.ok(artifacts.traces.firstPass);
        assert.ok(artifacts.devtoolsLogs.firstPass);
        assert.ok(artifacts.traces.secondPass);
        assert.ok(artifacts.devtoolsLogs.secondPass);
      });
  });

  it('doesn\'t leave networkRecords as an artifact', () => {
    const config = new Config({
      passes: [{
        recordTrace: true,
        passName: 'firstPass',
        gatherers: [{instance: new TestGatherer()}],
      }, {
        recordTrace: true,
        passName: 'secondPass',
        gatherers: [{instance: new TestGatherer()}],
      }],
    });
    const options = {
      driver: fakeDriver,
      requestedUrl: 'https://example.com',
      settings: config.settings,
    };

    return GatherRunner.run(config.passes, options)
      .then(artifacts => {
        assert.equal(artifacts.networkRecords, undefined);
      });
  });

  it('saves trace and devtoolsLog with error prefix when there was a runtime error', async () => {
    const requestedUrl = 'https://example.com';
    const driver = Object.assign({}, fakeDriver, {
      // resolved URL here does not match any request in the network records, causing a runtime error.
      gotoURL: async _ => requestedUrl,
      online: true,
      endDevtoolsLog: () => [],
    });

    const config = new Config({
      passes: [{
        passName: 'firstPass',
        recordTrace: true,
        gatherers: [{instance: new TestGatherer()}],
      }],
    });
    const options = {driver, requestedUrl, settings: config.settings};
    const artifacts = await GatherRunner.run(config.passes, options);

    expect(artifacts.PageLoadError.code).toEqual('NO_DOCUMENT_REQUEST');
    expect(artifacts.TestGatherer).toBeUndefined();

    // The only loadData available should be prefixed with `pageLoadError-`.
    expect(Object.keys(artifacts.traces)).toEqual(['pageLoadError-firstPass']);
    expect(Object.keys(artifacts.devtoolsLogs)).toEqual(['pageLoadError-firstPass']);
  });

  it('does not run additional passes after a runtime error', async () => {
    const t1 = new (class Test1 extends TestGatherer {})();
    const t2 = new (class Test2 extends TestGatherer {})();
    const t3 = new (class Test3 extends TestGatherer {})();
    const config = new Config({
      passes: [{
        passName: 'firstPass',
        recordTrace: true,
        gatherers: [{instance: t1}],
      }, {
        passName: 'secondPass',
        recordTrace: true,
        gatherers: [{instance: t2}],
      }, {
        passName: 'thirdPass',
        recordTrace: true,
        gatherers: [{instance: t3}],
      }],
    });

    const requestedUrl = 'https://www.reddit.com/r/nba';
    let firstLoad = true;
    const driver = Object.assign({}, fakeDriver, {
      // Loads the page successfully in the first pass, fails with NO_FCP in the second.
      async gotoURL(url) {
        if (url.includes('blank')) return null;
        if (firstLoad) {
          firstLoad = false;
          return requestedUrl;
        } else {
          throw new LHError(LHError.errors.NO_FCP);
        }
      },
      online: true,
    });
    const options = {driver, requestedUrl, settings: config.settings};
    const artifacts = await GatherRunner.run(config.passes, options);

    // t1.pass() and t2.pass() called; t3.pass(), after the error, was not.
    expect(t1.called).toBe(true);
    expect(t2.called).toBe(true);
    expect(t3.called).toBe(false);

    // But only t1 has a valid artifact; t2 and t3 aren't defined.
    expect(artifacts.Test1).toBe('MyArtifact');
    expect(artifacts.Test2).toBeUndefined();
    expect(artifacts.Test3).toBeUndefined();

    // PageLoadError artifact has the error.
    expect(artifacts.PageLoadError).toBeInstanceOf(LHError);
    expect(artifacts.PageLoadError.code).toEqual('NO_FCP');

    // firstPass has a saved trace and devtoolsLog, secondPass has an error trace and log.
    expect(Object.keys(artifacts.traces)).toEqual(['firstPass', 'pageLoadError-secondPass']);
    expect(Object.keys(artifacts.devtoolsLogs)).toEqual(['firstPass', 'pageLoadError-secondPass']);
  });

  describe('#getNetworkError', () => {
    it('passes when the page is loaded', () => {
      const url = 'http://the-page.com';
      const mainRecord = new NetworkRequest();
      mainRecord.url = url;
      assert.ok(!GatherRunner.getNetworkError(mainRecord));
    });

    it('fails when page fails to load', () => {
      const url = 'http://the-page.com';
      const mainRecord = new NetworkRequest();
      mainRecord.url = url;
      mainRecord.failed = true;
      mainRecord.localizedFailDescription = 'foobar';
      const error = GatherRunner.getNetworkError(mainRecord);
      assert.equal(error.message, 'FAILED_DOCUMENT_REQUEST');
      assert.equal(error.code, 'FAILED_DOCUMENT_REQUEST');
      expect(error.friendlyMessage)
        .toBeDisplayString(/^Lighthouse was unable to reliably load.*foobar/);
    });

    it('fails when page times out', () => {
      const error = GatherRunner.getNetworkError(undefined);
      assert.equal(error.message, 'NO_DOCUMENT_REQUEST');
      assert.equal(error.code, 'NO_DOCUMENT_REQUEST');
      expect(error.friendlyMessage).toBeDisplayString(/^Lighthouse was unable to reliably load/);
    });

    it('fails when page returns with a 404', () => {
      const url = 'http://the-page.com';
      const mainRecord = new NetworkRequest();
      mainRecord.url = url;
      mainRecord.statusCode = 404;
      const error = GatherRunner.getNetworkError(mainRecord);
      assert.equal(error.message, 'ERRORED_DOCUMENT_REQUEST');
      assert.equal(error.code, 'ERRORED_DOCUMENT_REQUEST');
      expect(error.friendlyMessage)
        .toBeDisplayString(/^Lighthouse was unable to reliably load.*404/);
    });

    it('fails when page returns with a 500', () => {
      const url = 'http://the-page.com';
      const mainRecord = new NetworkRequest();
      mainRecord.url = url;
      mainRecord.statusCode = 500;
      const error = GatherRunner.getNetworkError(mainRecord);
      assert.equal(error.message, 'ERRORED_DOCUMENT_REQUEST');
      assert.equal(error.code, 'ERRORED_DOCUMENT_REQUEST');
      expect(error.friendlyMessage)
        .toBeDisplayString(/^Lighthouse was unable to reliably load.*500/);
    });

    it('fails when page domain doesn\'t resolve', () => {
      const url = 'http://the-page.com';
      const mainRecord = new NetworkRequest();
      mainRecord.url = url;
      mainRecord.failed = true;
      mainRecord.localizedFailDescription = 'net::ERR_NAME_NOT_RESOLVED';
      const error = GatherRunner.getNetworkError(mainRecord);
      assert.equal(error.message, 'DNS_FAILURE');
      assert.equal(error.code, 'DNS_FAILURE');
      expect(error.friendlyMessage).toBeDisplayString(/^DNS servers could not resolve/);
    });
  });

  describe('#getInterstitialError', () => {
    it('passes when the page was not requested', () => {
      expect(GatherRunner.getInterstitialError(undefined, [])).toBeUndefined();
    });

    it('passes when the page is loaded', () => {
      const url = 'http://the-page.com';
      const mainRecord = new NetworkRequest();
      mainRecord.url = url;
      expect(GatherRunner.getInterstitialError(mainRecord, [mainRecord])).toBeUndefined();
    });

    it('passes when page fails to load normally', () => {
      const url = 'http://the-page.com';
      const mainRecord = new NetworkRequest();
      mainRecord.url = url;
      mainRecord.failed = true;
      mainRecord.localizedFailDescription = 'foobar';
      expect(GatherRunner.getInterstitialError(mainRecord, [mainRecord])).toBeUndefined();
    });

    it('passes when page gets a generic interstitial but somehow also loads everything', () => {
      // This case, AFAIK, is impossible, but we'll err on the side of not tanking the run.
      const url = 'http://the-page.com';
      const mainRecord = new NetworkRequest();
      mainRecord.url = url;
      const interstitialRecord = new NetworkRequest();
      interstitialRecord.url = 'data:text/html;base64,abcdef';
      interstitialRecord.documentURL = 'chrome-error://chromewebdata/';
      const records = [mainRecord, interstitialRecord];
      expect(GatherRunner.getInterstitialError(mainRecord, records)).toBeUndefined();
    });

    it('fails when page gets a generic interstitial', () => {
      const url = 'http://the-page.com';
      const mainRecord = new NetworkRequest();
      mainRecord.url = url;
      mainRecord.failed = true;
      mainRecord.localizedFailDescription = 'ERR_CONNECTION_RESET';
      const interstitialRecord = new NetworkRequest();
      interstitialRecord.url = 'data:text/html;base64,abcdef';
      interstitialRecord.documentURL = 'chrome-error://chromewebdata/';
      const records = [mainRecord, interstitialRecord];
      const error = GatherRunner.getInterstitialError(mainRecord, records);
      expect(error.message).toEqual('CHROME_INTERSTITIAL_ERROR');
      expect(error.code).toEqual('CHROME_INTERSTITIAL_ERROR');
      expect(error.friendlyMessage).toBeDisplayString(/^Chrome prevented/);
    });

    it('fails when page gets a security interstitial', () => {
      const url = 'http://the-page.com';
      const mainRecord = new NetworkRequest();
      mainRecord.url = url;
      mainRecord.failed = true;
      mainRecord.localizedFailDescription = 'net::ERR_CERT_COMMON_NAME_INVALID';
      const interstitialRecord = new NetworkRequest();
      interstitialRecord.url = 'data:text/html;base64,abcdef';
      interstitialRecord.documentURL = 'chrome-error://chromewebdata/';
      const records = [mainRecord, interstitialRecord];
      const error = GatherRunner.getInterstitialError(mainRecord, records);
      expect(error.message).toEqual('INSECURE_DOCUMENT_REQUEST');
      expect(error.code).toEqual('INSECURE_DOCUMENT_REQUEST');
      expect(error.friendlyMessage).toBeDisplayString(/valid security certificate/);
      expect(error.friendlyMessage).toBeDisplayString(/net::ERR_CERT_COMMON_NAME_INVALID/);
    });

    it('passes when page iframe gets a generic interstitial', () => {
      const url = 'http://the-page.com';
      const mainRecord = new NetworkRequest();
      mainRecord.url = url;
      mainRecord.failed = false;
      const iframeRecord = new NetworkRequest();
      iframeRecord.failed = true;
      iframeRecord.url = 'https://the-ad.com';
      iframeRecord.documentURL = 'https://the-ad.com';
      const interstitialRecord = new NetworkRequest();
      interstitialRecord.url = 'data:text/html;base64,abcdef';
      interstitialRecord.documentURL = 'chrome-error://chromewebdata/';
      const records = [mainRecord, iframeRecord, interstitialRecord];
      const error = GatherRunner.getInterstitialError(mainRecord, records);
      expect(error).toBeUndefined();
    });
  });

  describe('#getPageLoadError', () => {
    let navigationError;

    beforeEach(() => {
      navigationError = new Error('NAVIGATION_ERROR');
    });

    it('passes when the page is loaded', () => {
      const passContext = {url: 'http://the-page.com', driver: {online: true}};
      const mainRecord = new NetworkRequest();
      const loadData = {networkRecords: [mainRecord]};
      mainRecord.url = passContext.url;
      const error = GatherRunner.getPageLoadError(passContext, loadData, undefined);
      expect(error).toBeUndefined();
    });

    it('passes when the page is loaded, ignoring any fragment', () => {
      const url = 'http://example.com/#/page/list';
      const mainRecord = new NetworkRequest();
      const passContext = {url, driver: {online: true}};
      const loadData = {networkRecords: [mainRecord]};
      mainRecord.url = 'http://example.com';
      const error = GatherRunner.getPageLoadError(passContext, loadData, undefined);
      expect(error).toBeUndefined();
    });

    it('passes when the page is offline', () => {
      const passContext = {url: 'http://the-page.com', driver: {online: false}};
      const mainRecord = new NetworkRequest();
      const loadData = {networkRecords: [mainRecord]};
      mainRecord.url = passContext.url;
      mainRecord.failed = true;

      const error = GatherRunner.getPageLoadError(passContext, loadData, undefined);
      expect(error).toBeUndefined();
    });

    it('fails with interstitial error first', () => {
      const passContext = {url: 'http://the-page.com', driver: {online: true}};
      const mainRecord = new NetworkRequest();
      const interstitialRecord = new NetworkRequest();
      const loadData = {networkRecords: [mainRecord, interstitialRecord]};

      mainRecord.url = passContext.url;
      mainRecord.failed = true;
      interstitialRecord.url = 'data:text/html;base64,abcdef';
      interstitialRecord.documentURL = 'chrome-error://chromewebdata/';

      const error = GatherRunner.getPageLoadError(passContext, loadData, navigationError);
      expect(error.message).toEqual('CHROME_INTERSTITIAL_ERROR');
    });

    it('fails with network error next', () => {
      const passContext = {url: 'http://the-page.com', driver: {online: true}};
      const mainRecord = new NetworkRequest();
      const loadData = {networkRecords: [mainRecord]};

      mainRecord.url = passContext.url;
      mainRecord.failed = true;

      const error = GatherRunner.getPageLoadError(passContext, loadData, navigationError);
      expect(error.message).toEqual('FAILED_DOCUMENT_REQUEST');
    });

    it('fails with nav error last', () => {
      const passContext = {url: 'http://the-page.com', driver: {online: true}};
      const mainRecord = new NetworkRequest();
      const loadData = {networkRecords: [mainRecord]};

      mainRecord.url = passContext.url;

      const error = GatherRunner.getPageLoadError(passContext, loadData, navigationError);
      expect(error.message).toEqual('NAVIGATION_ERROR');
    });
  });

  describe('artifact collection', () => {
    // Make sure our gatherers never execute in parallel
    it('runs gatherer lifecycle methods strictly in sequence', async () => {
      const counter = {
        beforePass: 0,
        pass: 0,
        afterPass: 0,
      };
      const shortPause = () => new Promise(resolve => setTimeout(resolve, 50));
      async function fastish(counterName, value) {
        assert.strictEqual(counter[counterName], value - 1);
        counter[counterName] = value;
        await shortPause();
        assert.strictEqual(counter[counterName], value);
      }
      async function medium(counterName, value) {
        await Promise.resolve();
        await Promise.resolve();
        await fastish(counterName, value);
      }
      async function slowwwww(counterName, value) {
        await shortPause();
        await shortPause();
        await medium(counterName, value);
      }

      const gatherers = [
        class First extends Gatherer {
          async beforePass() {
            await slowwwww('beforePass', 1);
          }
          async pass() {
            await slowwwww('pass', 1);
          }
          async afterPass() {
            await slowwwww('afterPass', 1);
            return this.name;
          }
        },
        class Second extends Gatherer {
          async beforePass() {
            await medium('beforePass', 2);
          }
          async pass() {
            await medium('pass', 2);
          }
          async afterPass() {
            await medium('afterPass', 2);
            return this.name;
          }
        },
        class Third extends Gatherer {
          beforePass() {
            return fastish('beforePass', 3);
          }
          pass() {
            return fastish('pass', 3);
          }
          async afterPass() {
            await fastish('afterPass', 3);
            return this.name;
          }
        },
      ];
      const config = new Config({
        passes: [{
          gatherers: gatherers.map(G => ({instance: new G()})),
        }],
      });

      const artifacts = await GatherRunner.run(config.passes, {
        driver: fakeDriver,
        requestedUrl: 'https://example.com',
        settings: config.settings,
      });

      // Ensure artifacts returned and not errors.
      gatherers.forEach(gatherer => {
        assert.strictEqual(artifacts[gatherer.name], gatherer.name);
      });
    });

    it('supports sync and async return of artifacts from gatherers', () => {
      const gatherers = [
        // sync
        new class BeforeSync extends Gatherer {
          beforePass() {
            return this.name;
          }
        }(),
        new class PassSync extends Gatherer {
          pass() {
            return this.name;
          }
        }(),
        new class AfterSync extends Gatherer {
          afterPass() {
            return this.name;
          }
        }(),

        // async
        new class BeforePromise extends Gatherer {
          beforePass() {
            return Promise.resolve(this.name);
          }
        }(),
        new class PassPromise extends Gatherer {
          pass() {
            return Promise.resolve(this.name);
          }
        }(),
        new class AfterPromise extends Gatherer {
          afterPass() {
            return Promise.resolve(this.name);
          }
        }(),
      ].map(instance => ({instance}));
      const gathererNames = gatherers.map(gatherer => gatherer.instance.name);
      const config = new Config({
        passes: [{
          gatherers,
        }],
      });

      return GatherRunner.run(config.passes, {
        driver: fakeDriver,
        requestedUrl: 'https://example.com',
        settings: config.settings,
      }).then(artifacts => {
        gathererNames.forEach(gathererName => {
          assert.strictEqual(artifacts[gathererName], gathererName);
        });
      });
    });

    it('passes gatherer options', () => {
      const calls = {beforePass: [], pass: [], afterPass: []};
      class EavesdropGatherer extends Gatherer {
        beforePass(context) {
          calls.beforePass.push(context.options);
        }
        pass(context) {
          calls.pass.push(context.options);
        }
        afterPass(context) {
          calls.afterPass.push(context.options);
          return context.options.x || 'none';
        }
      }

      const gatherers = [
        {instance: new class EavesdropGatherer1 extends EavesdropGatherer {}(), options: {x: 1}},
        {instance: new class EavesdropGatherer2 extends EavesdropGatherer {}(), options: {x: 2}},
        {instance: new class EavesdropGatherer3 extends EavesdropGatherer {}()},
      ];

      const config = new Config({
        passes: [{gatherers}],
      });

      return GatherRunner.run(config.passes, {
        driver: fakeDriver,
        requestedUrl: 'https://example.com',
        settings: config.settings,
      }).then(artifacts => {
        assert.equal(artifacts.EavesdropGatherer1, 1);
        assert.equal(artifacts.EavesdropGatherer2, 2);
        assert.equal(artifacts.EavesdropGatherer3, 'none');

        // assert that all three phases received the gatherer options expected
        const expectedOptions = [{x: 1}, {x: 2}, {}];
        for (let i = 0; i < 3; i++) {
          assert.deepEqual(calls.beforePass[i], expectedOptions[i]);
          assert.deepEqual(calls.pass[i], expectedOptions[i]);
          assert.deepEqual(calls.afterPass[i], expectedOptions[i]);
        }
      });
    });

    it('uses the last not-undefined phase result as artifact', () => {
      const recoverableError = new Error('My recoverable error');
      const someOtherError = new Error('Bad, bad error.');

      // Gatherer results are all expected to be arrays of promises
      const gathererResults = {
        // 97 wins.
        AfterGatherer: [
          Promise.resolve(65),
          Promise.resolve(72),
          Promise.resolve(97),
        ],

        // 284 wins.
        PassGatherer: [
          Promise.resolve(220),
          Promise.resolve(284),
          Promise.resolve(undefined),
        ],

        // Error wins.
        SingleErrorGatherer: [
          Promise.reject(recoverableError),
          Promise.resolve(1184),
          Promise.resolve(1210),
        ],

        // First error wins.
        TwoErrorGatherer: [
          Promise.reject(recoverableError),
          Promise.reject(someOtherError),
          Promise.resolve(1729),
        ],
      };

      return GatherRunner.collectArtifacts(gathererResults).then(({artifacts}) => {
        assert.strictEqual(artifacts.AfterGatherer, 97);
        assert.strictEqual(artifacts.PassGatherer, 284);
        assert.strictEqual(artifacts.SingleErrorGatherer, recoverableError);
        assert.strictEqual(artifacts.TwoErrorGatherer, recoverableError);
      });
    });

    it('produces a deduped LighthouseRunWarnings artifact from array of warnings', async () => {
      const runWarnings = [
        'warning0',
        'warning1',
        'warning2',
      ];

      class WarningGatherer extends Gatherer {
        afterPass(passContext) {
          passContext.LighthouseRunWarnings.push(...runWarnings, ...runWarnings);
          assert.strictEqual(passContext.LighthouseRunWarnings.length, runWarnings.length * 2);

          return '';
        }
      }

      const config = new Config({
        passes: [{
          gatherers: [{instance: new WarningGatherer()}],
        }],
      });
      const artifacts = await GatherRunner.run(config.passes, {
        driver: fakeDriver,
        requestedUrl: 'https://example.com',
        settings: config.settings,
      });
      assert.deepStrictEqual(artifacts.LighthouseRunWarnings, runWarnings);
    });

    it('supports sync and async throwing of errors from gatherers', () => {
      const gatherers = [
        // sync
        new class BeforeSync extends Gatherer {
          beforePass() {
            throw new Error(this.name);
          }
        }(),
        new class PassSync extends Gatherer {
          pass() {
            throw new Error(this.name);
          }
        }(),
        new class AfterSync extends Gatherer {
          afterPass() {
            throw new Error(this.name);
          }
        }(),

        // async
        new class BeforePromise extends Gatherer {
          beforePass() {
            const err = new Error(this.name);
            return Promise.reject(err);
          }
        }(),
        new class PassPromise extends Gatherer {
          pass() {
            const err = new Error(this.name);
            return Promise.reject(err);
          }
        }(),
        new class AfterPromise extends Gatherer {
          afterPass() {
            const err = new Error(this.name);
            return Promise.reject(err);
          }
        }(),
      ].map(instance => ({instance}));
      const gathererNames = gatherers.map(gatherer => gatherer.instance.name);
      const config = new Config({
        passes: [{
          gatherers,
        }],
      });

      return GatherRunner.run(config.passes, {
        driver: fakeDriver,
        requestedUrl: 'https://example.com',
        settings: config.settings,
      }).then(artifacts => {
        gathererNames.forEach(gathererName => {
          const errorArtifact = artifacts[gathererName];
          assert.ok(errorArtifact instanceof Error);
          assert.strictEqual(errorArtifact.message, gathererName);
        });
      });
    });

    it('rejects if a gatherer does not provide an artifact', () => {
      const config = new Config({
        passes: [{
          recordTrace: true,
          passName: 'firstPass',
          gatherers: [
            {instance: new TestGathererNoArtifact()},
          ],
        }],
      });

      return GatherRunner.run(config.passes, {
        driver: fakeDriver,
        requestedUrl: 'https://example.com',
        settings: config.settings,
      }).then(_ => assert.ok(false), _ => assert.ok(true));
    });

    it('rejects when domain name can\'t be resolved', () => {
      const config = new Config({
        passes: [{
          recordTrace: true,
          passName: 'firstPass',
          gatherers: [],
        }],
      });

      // Arrange for driver to return unresolved request.
      const requestedUrl = 'http://www.some-non-existing-domain.com/';
      const unresolvedDriver = Object.assign({}, fakeDriver, {
        online: true,
        gotoURL() {
          return Promise.resolve(requestedUrl);
        },
        endDevtoolsLog() {
          return unresolvedPerfLog;
        },
      });

      return GatherRunner.run(config.passes, {
        driver: unresolvedDriver,
        requestedUrl,
        settings: config.settings,
      }).then(artifacts => {
        assert.equal(artifacts.LighthouseRunWarnings.length, 1);
        expect(artifacts.LighthouseRunWarnings[0])
          .toBeDisplayString(/DNS servers could not resolve/);
      });
    });

    it('resolves when domain name can\'t be resolved but is offline', () => {
      const config = new Config({
        passes: [{
          recordTrace: true,
          passName: 'firstPass',
          gatherers: [],
        }],
      });

      // Arrange for driver to return unresolved request.
      const requestedUrl = 'http://www.some-non-existing-domain.com/';
      const unresolvedDriver = Object.assign({}, fakeDriver, {
        online: false,
        gotoURL() {
          return Promise.resolve(requestedUrl);
        },
        endDevtoolsLog() {
          return unresolvedPerfLog;
        },
      });

      return GatherRunner.run(config.passes, {
        driver: unresolvedDriver,
        requestedUrl,
        settings: config.settings,
      })
        .then(_ => {
          assert.ok(true);
        });
    });
  });

  describe('.getWebAppManifest', () => {
    const MANIFEST_URL = 'https://example.com/manifest.json';
    let passContext;

    beforeEach(() => {
      passContext = {
        url: 'https://example.com/index.html',
        baseArtifacts: {},
        driver: fakeDriver,
      };
    });

    it('should pass through manifest when null', async () => {
      const getAppManifest = jest.spyOn(fakeDriver, 'getAppManifest');
      getAppManifest.mockResolvedValueOnce(null);
      const result = await GatherRunner.getWebAppManifest(passContext);
      expect(result).toEqual(null);
    });

    it('should parse the manifest when found', async () => {
      const manifest = {name: 'App'};
      const getAppManifest = jest.spyOn(fakeDriver, 'getAppManifest');
      getAppManifest.mockResolvedValueOnce({data: JSON.stringify(manifest), url: MANIFEST_URL});
      const result = await GatherRunner.getWebAppManifest(passContext);
      expect(result).toHaveProperty('raw', JSON.stringify(manifest));
      expect(result.value).toMatchObject({
        name: {value: 'App', raw: 'App'},
        start_url: {value: passContext.url, raw: undefined},
      });
    });
  });
});
