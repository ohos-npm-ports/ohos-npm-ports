// @test-package: vite-plus
// @test-format: cjs
const assert = require('node:assert/strict');
const { readFileSync, writeFileSync } = require('node:fs');
const { resolve, dirname } = require('node:path');
const { runInNewContext } = require('node:vm');

const root = process.argv[2] || dirname(require.resolve('vite-plus/package.json'));
const source = readFileSync(resolve(root, 'dist/bin.js'), 'utf8');
const start = source.indexOf('function resolveCore(');
assert.notEqual(start, -1);
const implementation = source.slice(start, source.indexOf('\n}', start) + 2);
for (const platform of ['openharmony', 'linux', 'darwin', 'win32']) {
  for (const [name, version, expected] of [
    ['@ohos-npm-ports/vite-plus', '1.0.0-2', '1.0.0'],
    ['@ohos-npm-ports/vite-plus', '1.0.0-beta.1-2', '1.0.0-beta.1'],
    ['vite-plus', '1.0.0', '1.0.0'],
    ['vite-plus', '1.0.0-beta.1', '1.0.0-beta.1'],
  ]) {
    if (process.env.PORT_TEST_MODE === 'baseline' && name.startsWith('@ohos-npm-ports/')) continue;
    const checks = [];
    const fn = runInNewContext(`(${implementation.replace('import.meta.url', '"cli"')})`, {
      process: { platform, cwd: () => '/project' },
      createRequire: () => ({ resolve: value => value }),
      readFileSync: () => JSON.stringify({ name, version }),
      checkCoreVersion: (_, value) => checks.push(value),
      checkProjectCoreVersion: (_, __, value) => checks.push(value),
    });
    assert.equal(fn('/pack'), 'vite/pack');
    assert.deepEqual(checks, [expected, expected], platform);
  }
}
console.log('OK: core version resolution on openharmony/linux/darwin/win32');

if (process.env.PORT_TEST_REPORT) writeFileSync(process.env.PORT_TEST_REPORT, JSON.stringify({ result: { coreResolution: true } }));
