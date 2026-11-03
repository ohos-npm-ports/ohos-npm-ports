import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

export function verifyCoreResolution(root, mode = '') {
  const source = readFileSync(resolve(root, 'dist/bin.js'), 'utf8');
  const start = source.indexOf('function resolveCore(');
  assert.notEqual(start, -1);
  const implementation = source.slice(start, source.indexOf('\n}', start) + 2);
  for (const platform of ['openharmony', 'linux', 'darwin', 'win32']) {
    for (const [name, version, expected] of [
      ['@ohos-npm-ports/vite-plus', '1.4.0-2', '1.4.0'],
      ['@ohos-npm-ports/vite-plus', '1.4.0-beta.1-2', '1.4.0-beta.1'],
      ['vite-plus', '1.4.0', '1.4.0'],
      ['vite-plus', '1.4.0-beta.1', '1.4.0-beta.1'],
    ]) {
      if (mode === 'baseline' && name.startsWith('@ohos-npm-ports/')) continue;
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
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.ok(process.argv[2], 'Package directory is required');
  verifyCoreResolution(process.argv[2]);
  console.log('OK: core version resolution on openharmony/linux/darwin/win32');
}
