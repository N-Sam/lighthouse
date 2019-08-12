/**
 * @license Copyright 2019 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

const assert = require('assert');
const LegacyJavascript = require('../../audits/legacy-javascript.js');
const networkRecordsToDevtoolsLog = require('../network-records-to-devtools-log.js');

/**
 * @param {Array<{url: string, code: string}>} scripts
 * @return {LH.Artifacts}
 */
const createArtifacts = (scripts) => {
  const networkRecords = scripts.map(({url}, index) => ({
    requestId: String(index),
    url,
  }));
  return {
    devtoolsLogs: {defaultPass: networkRecordsToDevtoolsLog(networkRecords)},
    ScriptElements: scripts.reduce((acc, {code}, index) => {
      acc[String(index)] = {
        content: code,
        requestId: String(index),
      };
      return acc;
    }, {}),
  };
};

/* eslint-env jest */
describe('LegacyJavaScript audit', () => {
  it('passes code with no polyfills', async () => {
    const artifacts = createArtifacts([
      {
        code: 'var message = "hello world"; console.log(message);',
        url: 'https://www.example.com/a.js',
      },
      {
        code: 'SomeGlobal = function() {}',
        url: 'https://www.example.com/a.js',
      },
      {
        code: 'SomeClass.prototype.someFn = function() {}',
        url: 'https://www.example.com/a.js',
      },
      {
        code: 'Object.defineProperty(SomeClass.prototype, "someFn", function() {})',
        url: 'https://www.example.com/a.js',
      },
    ]);
    const result = await LegacyJavascript.audit(artifacts, {computedCache: new Map()});
    assert.equal(result.score, 1);
    assert.equal(result.numericValue, 0);
  });

  it('fails code with a legacy polyfill', async () => {
    const artifacts = createArtifacts([
      {
        code: 'String.prototype.repeat = function() {}',
        url: 'https://www.example.com/a.js',
      },
    ]);
    const result = await LegacyJavascript.audit(artifacts, {computedCache: new Map()});
    assert.equal(result.score, 0);
    assert.equal(result.numericValue, 1);
    assert.equal(result.details.items[0].description, 'String.prototype.repeat');
  });

  it('fails code with multiple legacy polyfills', async () => {
    const artifacts = createArtifacts([
      {
        code: 'String.prototype.repeat = function() {}; String.prototype.includes = function() {}',
        url: 'https://www.example.com/a.js',
      },
    ]);
    const result = await LegacyJavascript.audit(artifacts, {computedCache: new Map()});
    assert.equal(result.score, 0);
    assert.equal(result.numericValue, 2);
  });

  it('counts multiple of the same polyfill from the same script only once', async () => {
    const artifacts = createArtifacts([
      {
        code: (() => {
          // eslint-disable-next-line no-extend-native
          String.prototype.repeat = function() {};
          // eslint-disable-next-line no-extend-native
          Object.defineProperty(String.prototype, 'repeat', function() {});
        }),
        url: 'https://www.example.com/a.js',
      },
    ]);
    const result = await LegacyJavascript.audit(artifacts, {computedCache: new Map()});
    assert.equal(result.score, 0);
    assert.equal(result.numericValue, 1);
  });

  it('displays a counter for multiple of the same polyfill from different scripts', async () => {
    const artifacts = createArtifacts([
      {
        code: 'String.prototype.repeat = function() {}',
        url: 'https://www.example.com/a.js',
      },
      {
        code: 'String.prototype["repeat"] = function() {}',
        url: 'https://www.example.com/b.js',
      },
    ]);
    const result = await LegacyJavascript.audit(artifacts, {computedCache: new Map()});
    assert.equal(result.score, 0);
    assert.equal(result.numericValue, 2);
    assert.equal(result.details.items[0].description, 'String.prototype.repeat (1 / 2)');
    assert.equal(result.details.items[1].description, 'String.prototype.repeat (2 / 2)');
  });

  it('should identify polyfills in multiple patterns', async () => {
    const artifacts = createArtifacts([
      {
        code: 'String.prototype.repeat = function() {}',
        url: 'https://www.example.com/a.js',
      },
      {
        code: 'String.prototype["repeat"] = function() {}',
        url: 'https://www.example.com/b.js',
      },
      {
        code: 'String.prototype[\'repeat\'] = function() {}',
        url: 'https://www.example.com/c.js',
      },
      {
        code: 'Object.defineProperty(String.prototype, "repeat", function() {})',
        url: 'https://www.example.com/d.js',
      },
      {
        code: 'Object.defineProperty(String.prototype, \'repeat\', function() {})',
        url: 'https://www.example.com/e.js',
      },
      {
        code: 'Object.defineProperty(window, \'WeakMap\', function() {})',
        url: 'https://www.example.com/e.js',
      },
      {
        code: ';e(e.S,"Object",{values:function values(t){return i(t)}})',
        url: 'https://www.example.com/f.js',
      },
      {
        code: 'WeakMap = function() {}',
        url: 'https://www.example.com/f.js',
      },
      {
        code: 'window.WeakMap = function() {}',
        url: 'https://www.example.com/f.js',
      },
      {
        code: 'String.raw = function() {}',
        url: 'https://www.example.com/f.js',
      },
    ]);
    const result = await LegacyJavascript.audit(artifacts, {computedCache: new Map()});
    assert.equal(result.score, 0);
    assert.equal(result.numericValue, Object.keys(artifacts.ScriptElements).length);
  });
});