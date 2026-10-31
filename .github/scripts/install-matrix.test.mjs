import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { containsPackage, platformMatches, validateBins } from './run-install-matrix.mjs';

test('generic install respects platform and architecture filters', () => {
  assert.equal(platformMatches({}, 'linux', 'x64'), true);
  assert.equal(platformMatches({ os: ['openharmony'], cpu: ['arm64'] }, 'openharmony', 'arm64'), true);
  assert.equal(platformMatches({ os: ['openharmony'], cpu: ['arm64'] }, 'linux', 'arm64'), false);
  assert.equal(platformMatches({ os: ['!win32'] }, 'linux', 'x64'), true);
  assert.equal(platformMatches({ os: ['!win32'] }, 'win32', 'x64'), false);
  assert.equal(platformMatches({ os: 'openharmony', cpu: 'arm64' }, 'openharmony', 'arm64'), true);
});

test('installed dependency lookup handles aliases, nesting and cycles', () => {
  const shared = { name: '@ohos-npm-ports/slot', version: '1.2.3-4', dependencies: {} };
  const tree = { name: 'root', dependencies: { alias: { name: '@ohos-npm-ports/main', dependencies: { shared } } } };
  shared.dependencies.root = tree;
  tree.dependencies.bufferutil = { version: '4.0.9-8', resolved: 'http://127.0.0.1:4873/@ohos-npm-ports/bufferutil/-/bufferutil-4.0.9-8.tgz' };
  tree.dependencies.aliased = { resolved: 'npm:@ohos-npm-ports/slot@1.2.3-4' };
  assert.equal(containsPackage(tree, '@ohos-npm-ports/slot', '1.2.3-4'), true);
  assert.equal(containsPackage(tree, '@ohos-npm-ports/slot', '1.2.3-3'), false);
  assert.equal(containsPackage(tree, '@ohos-npm-ports/bufferutil', '4.0.9-8'), true);
  assert.equal(containsPackage(tree, '@ohos-npm-ports/bufferutil', '4.0.9-7'), false);
});

test('generic bin validation accepts string and object manifests and rejects missing shims', (t) => {
  const project = mkdtempSync(join(tmpdir(), 'install-matrix-test-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  mkdirSync(join(project, 'node_modules/.bin'), { recursive: true });
  writeFileSync(join(project, 'node_modules/.bin/demo'), '');
  writeFileSync(join(project, 'node_modules/.bin/other'), '');
  assert.doesNotThrow(() => validateBins({ name: '@scope/demo', bin: 'cli.js' }, project));
  assert.doesNotThrow(() => validateBins({ name: '@scope/demo', bin: { demo: 'cli.js', other: 'other.js' } }, project));
  assert.throws(() => validateBins({ name: '@scope/demo', bin: { missing: 'missing.js' } }, project), /Missing installed bin/);
});

test('OpenHarmony generic install uses the image compatibility setup', async () => {
  const { readFileSync } = await import('node:fs');
  const action = readFileSync('.github/actions/install-matrix/action.yml', 'utf8');
  assert.doesNotMatch(action, /setup-ci-runner\.sh/);
  assert.match(action, /node \.github\/scripts\/run-install-matrix\.mjs/);
  assert.match(action, /pattern: 'port-\*'/);
  assert.match(action, /EXPECTED_PLATFORM/);
  const runner = readFileSync('.github/scripts/run-install-matrix.mjs', 'utf8');
  assert.match(runner, /libexec/, 'generic install must inject the brew Python used by node-gyp');
  assert.match(runner, /environment\.PYTHON/);
});
