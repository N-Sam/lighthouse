/**
 * @license Copyright 2019 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

/**
 * @fileoverview Used to smoke test the build process.
 *
 * - The bundled code is a function that, given a module ID, returns the exports of that module.
 * - We eval the bundle string to get a reference to this function (with some global hacks to
 *   support unbundleable things).
 * - We try to locate the lighthouse-core/index.js module by executing this function on every
 *   possible number. This version of lighthouse-core/index.js will be wired to use all of the
 *   bundled modules, not node requires.
 * - Once we find the bundled lighthouse-core/index.js module, we stick it in node's require.cache
 *   so that all node require invocations for lighthouse-core/index.js will use our bundled module
 *   instead of the regular one.
 * - Finally, we kick off the lighthouse-cli/index.js entrypoint that ends up requiring the
 *   now-replaced lighthouse-core/index.js for its run.
 */

const fs = require('fs');
const path = require('path');
const rimraf = require('rimraf');
const ChromeProtocol = require('../../lighthouse-core/gather/connections/cri.js');

const LH_ROOT = path.resolve(__dirname, '../..');
const corePath = `${LH_ROOT}/lighthouse-core/index.js`;

// Oh yeahhhhh this works. Think of this as `requireBundled('../../lighthouse-core/index.js')`.
const lighthouse = (function getLighthouseCoreBundled() {
  // The eval will assign to `require`. Normally, that would be the require on the global object.
  // This `let` protects the global reference to the native require.
  // Doesn't need to have any value, but for good measure define a function that explicitly forbids
  // its own usage.
  // To be further convinced that this works (that the un-bundled files are not being loaded),
  // add some console.log's somewhere like `driver.js`, and
  // run `node build/tests/bundled-lighthouse-cli.js https://www.example.com`. You won't see them.
  /* eslint-disable-next-line */
  let require = () => {
    throw new Error('illegal require');
  };

  const lighthouseBundledCode = fs.readFileSync('dist/test-bundle.js', 'utf-8')
    // Some modules are impossible to bundle. So we cheat by leaning on global.
    // cri.js will be able to use native require. It's a minor defect - it means that some usages
    // of lh-error.js will not come from the bundled code.
    // TODO: use `globalThis` when we drop Node 10.
    .replace('new ChromeProtocol', 'new global.ChromeProtocol')
    // Needed for asset-saver.js.
    .replace(/rimraf\./g, 'global.rimraf.')
    .replace(/fs\.(writeFileSync|createWriteStream|mkdirSync)/g, 'global.$&');

  /* eslint-disable no-undef */
  // @ts-ignore
  global.ChromeProtocol = ChromeProtocol;
  // @ts-ignore
  global.rimraf = rimraf;
  // @ts-ignore
  global.fs = fs;
  /*  eslint-enable no-undef */

  const bundledLighthouseRequire = eval(lighthouseBundledCode);

  // Find the lighthouse module.
  // Every module is given an id (starting at 1). The core lighthouse module
  // is the only module that is a function named `lighthouse`.
  /** @type {import('../../lighthouse-core/index.js')} */
  let lighthouse;
  for (let i = 1; i < 1000; i++) {
    const module = bundledLighthouseRequire(i);
    if (module.name === 'lighthouse') {
      lighthouse = module;
      break;
    }
  }

  // @ts-ignore
  if (!lighthouse) throw new Error('could not find lighthouse module');

  return lighthouse;
})();

// Shim the core module with the bundled code.

// @ts-ignore
lighthouse.__PATCHED__ = true;
require.cache[corePath] = {
  exports: lighthouse,
};

// @ts-ignore
if (!require('../../lighthouse-core/index.js').__PATCHED__) {
  throw new Error('error patching core module');
}

// Kick off the CLI.
require('../../lighthouse-cli/index.js');
