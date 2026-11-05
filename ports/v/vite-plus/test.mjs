import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

function verifyCoreResolution(root, mode = '') {
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

function verifyProjectBuild(root, projectDir) {
  const fixture = mkdtempSync(resolve(projectDir, '.vite-plus-test-'));
  try {
    writeFileSync(resolve(fixture, 'package.json'), '{"private":true,"type":"module"}\n');
    writeFileSync(resolve(fixture, 'index.html'), '<!doctype html><html><body><div id="app"></div><script type="module" src="/main.ts"></script></body></html>\n');
    writeFileSync(resolve(fixture, 'main.ts'), 'const message: string = "vite-plus-native-proof"; document.querySelector("#app")!.textContent = message;\n');
    execFileSync(process.execPath, [resolve(root, 'bin/vp'), 'build'], { cwd: fixture, encoding: 'utf8', timeout: 120000 });
    const output = resolve(fixture, 'dist');
    const files = readdirSync(output, { recursive: true }).filter(file => statSync(resolve(output, file)).isFile());
    const scripts = files.filter(file => file.endsWith('.js')).map(file => readFileSync(resolve(output, file), 'utf8')).join('\n');
    assert.ok(scripts.includes('vite-plus-native-proof'));
    assert.ok(!scripts.includes('message: string'));
    assert.match(readFileSync(resolve(output, 'index.html'), 'utf8'), /<script\b/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

export default function test({ requirePackage, resolvePackage, projectDir, mode }) {
  const root = dirname(resolvePackage('vite-plus/package.json'));
  const binding = requirePackage(resolve(root, 'binding/index.cjs'));
  assert.equal(typeof binding.run, 'function');
  assert.equal(typeof binding.runCommand, 'function');
  const output = execFileSync(process.execPath, [resolve(root, 'bin/vp'), '--version'], { encoding: 'utf8', timeout: 30000 });
  assert.match(output, /1\.4\.0/);
  verifyCoreResolution(root, mode);
  verifyProjectBuild(root, projectDir);
  return { result: { coreResolution: true, projectBuild: true }, assets: [] };
}
