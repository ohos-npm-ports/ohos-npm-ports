import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { addFiles, pinDependencies, removeDependencies, removeScripts, setDependency, setImport } from '../cli/manifest.mjs';

const runtime = fileURLToPath(new URL('../cli/runtime.sh', import.meta.url));
const manifest = fileURLToPath(new URL('../cli/manifest.mjs', import.meta.url));

test('manifest helpers are idempotent and preserve unrelated fields', () => {
  const pkg = { name: 'demo', postinstall: 'node install.js', files: ['index.js'], scripts: { build: 'tsc', prepare: 'husky install' } };
  assert.equal(addFiles(pkg, ['native/addon.node', 'index.js']), true);
  assert.equal(addFiles(pkg, ['native/addon.node']), false);
  assert.equal(removeScripts(pkg, ['prepare', 'postinstall', 'missing']), true);
  assert.equal(removeScripts(pkg, ['prepare', 'postinstall']), false);
  assert.deepEqual(pkg, { name: 'demo', files: ['index.js', 'native/addon.node'], scripts: { build: 'tsc' } });
});

test('manifest helpers do not create a restrictive files whitelist', () => {
  const pkg = { name: 'demo' };
  assert.equal(addFiles(pkg, ['native/addon.node']), false);
  assert.deepEqual(pkg, { name: 'demo' });
  assert.equal(removeScripts(pkg, ['prepare']), false);
  assert.deepEqual(pkg, { name: 'demo' });
  assert.throws(() => addFiles({ files: ['index.js'] }, ['../escape']), /Unsafe package file path/);
  assert.throws(() => addFiles({ files: ['index.js'] }, ['/absolute']), /Unsafe package file path/);
  assert.throws(() => addFiles({ files: ['index.js'] }, ['!negated']), /Unsafe package file path/);
  assert.throws(() => removeScripts({ scripts: {} }, ['__proto__']), /Unsafe script name/);
});

test('Bash manifest helpers edit real package.json files', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'npm-ports-manifest-'));
  const file = join(root, 'package.json');
  writeFileSync(file, JSON.stringify({
    files: ['index.js'],
    scripts: { prepare: 'install', build: 'tsc' },
    dependencies: { remove: '1' },
    optionalDependencies: { one: 'workspace:*', two: 'workspace:*' },
  }));
  const env = { ...process.env, NPM_PORTS_NODE: process.execPath, NPM_PORTS_MANIFEST: manifest, NPM_PORTS_RUNTIME: runtime, MANIFEST_FILE: file };
  execFileSync('bash', ['-c', `set -e
source "$NPM_PORTS_RUNTIME"
manifest_add_files "$MANIFEST_FILE" native/addon.node
manifest_remove_script "$MANIFEST_FILE" prepare missing
manifest_set_dependency dependencies "$MANIFEST_FILE" playwright-core 'npm:@ohos-npm-ports/playwright-core@1.64.1-1'
manifest_remove_dependency dependencies "$MANIFEST_FILE" remove
manifest_pin_dependencies optionalDependencies "$MANIFEST_FILE" 1.2.3
manifest_set_import "$MANIFEST_FILE" '#opentui/parser-worker' './parser.worker.js'
`], { env });
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {
    files: ['index.js', 'native/addon.node'],
    scripts: { build: 'tsc' },
    dependencies: { 'playwright-core': 'npm:@ohos-npm-ports/playwright-core@1.64.1-1' },
    optionalDependencies: { one: '1.2.3', two: '1.2.3' },
    imports: { '#opentui/parser-worker': './parser.worker.js' },
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
});

test('dependency and import helpers are idempotent and preserve unrelated fields', () => {
  const pkg = {
    dependencies: { remove: '1', keep: '1' },
    optionalDependencies: { one: 'workspace:*', two: 'workspace:*' },
    scripts: { build: 'tsc' },
  };
  assert.equal(setDependency(pkg, 'dependencies', 'playwright-core', 'npm:@ohos-npm-ports/playwright-core@1.64.1-1'), true);
  assert.equal(setDependency(pkg, 'dependencies', 'playwright-core', 'npm:@ohos-npm-ports/playwright-core@1.64.1-1'), false);
  assert.equal(removeDependencies(pkg, 'dependencies', ['remove', 'missing']), true);
  assert.equal(removeDependencies(pkg, 'dependencies', ['remove']), false);
  assert.equal(pinDependencies(pkg, 'optionalDependencies', '1.2.3'), true);
  assert.equal(pinDependencies(pkg, 'optionalDependencies', '1.2.3'), false);
  assert.equal(setImport(pkg, '#opentui/parser-worker', './parser.worker.js'), true);
  assert.equal(setImport(pkg, '#opentui/parser-worker', './parser.worker.js'), false);
  assert.equal(removeDependencies(pkg, 'peerDependencies', ['missing']), false);
  assert.deepEqual(pkg, {
    dependencies: { keep: '1', 'playwright-core': 'npm:@ohos-npm-ports/playwright-core@1.64.1-1' },
    optionalDependencies: { one: '1.2.3', two: '1.2.3' },
    scripts: { build: 'tsc' },
    imports: { '#opentui/parser-worker': './parser.worker.js' },
  });
  assert.equal(Object.hasOwn(pkg, 'peerDependencies'), false);
});

test('dependency and import helpers reject invalid fields and keys', () => {
  assert.throws(() => setDependency({}, 'scripts', 'demo', '1'), /Unsupported manifest field/);
  assert.throws(() => setDependency({}, 'dependencies', '__proto__', '1'), /Unsafe manifest key/);
  assert.throws(() => setDependency({}, 'dependencies', 'demo', ''), /non-empty strings/);
  assert.throws(() => setImport({}, 'parser-worker', './parser.worker.js'), /Invalid import specifier/);
  assert.throws(() => pinDependencies({}, 'dependencies', ''), /non-empty strings/);
});
