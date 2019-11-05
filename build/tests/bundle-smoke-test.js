/**
 * @license Copyright 2019 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

const fs = require('fs');
const {promisify} = require('util');
const {execFile} = require('child_process');
const execFileAsync = promisify(execFile);
const firehouse = require('../../lighthouse-cli/test/smokehouse/firehouse.js');
const bundleBuilder = require('../build-bundle.js');
const {server, serverForOffline} = require('../../lighthouse-cli/test/fixtures/static-server.js');

const testEntryPath = `${__dirname}/../../lighthouse-core/index.js`;
const testDistPath = `${__dirname}/../../dist/test-bundle.js`;

/**
 * Run Lighthouse using a CLI that shims lighthouse-core with the output of the bundler.
 * @param {string} url
 * @param {LH.Config.Json=} config
 */
async function runLighthouseFromMinifiedBundle(url, config) {
  const lhrPath = `${__dirname}/../../.tmp/bundle-smoke-test-lhr.json`;
  const gatherPath = `${__dirname}/../../.tmp/bundle-smoke-test-gather`;

  const args = [
    `${__dirname}/bundled-lighthouse-cli.js`,
    url,
    `-GA=${gatherPath}`,
    '--output=json',
    `--output-path=${lhrPath}`,
  ];

  if (config) {
    const configPath = `${__dirname}/../../.tmp/bundle-smoke-test-config.json`;
    fs.writeFileSync(configPath, JSON.stringify(config));
    args.push(`--config-path=${configPath}`);
  }

  await execFileAsync('node', args);

  const lhr = JSON.parse(fs.readFileSync(lhrPath, 'utf-8'));
  const artifacts = JSON.parse(fs.readFileSync(`${gatherPath}/artifacts.json`, 'utf-8'));

  return {
    lhr,
    artifacts,
  };
}

async function main() {
  await bundleBuilder.build(testEntryPath, testDistPath);

  server.listen(10200, 'localhost');
  serverForOffline.listen(10503, 'localhost');

  const results = await firehouse.runSmokes({
    runLighthouse: runLighthouseFromMinifiedBundle,
    urlFilterRegex: /byte|dbw/,
  });

  await new Promise(resolve => server.close(resolve));
  await new Promise(resolve => serverForOffline.close(resolve));

  process.exit(results.success ? 0 : 1);
}

main();
