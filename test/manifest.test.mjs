import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { addFiles, removeScripts } from '../cli/manifest.mjs';

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
  writeFileSync(file, JSON.stringify({ files: ['index.js'], scripts: { prepare: 'install', build: 'tsc' } }));
  const env = { ...process.env, NPM_PORTS_NODE: process.execPath, NPM_PORTS_MANIFEST: manifest, NPM_PORTS_RUNTIME: runtime, MANIFEST_FILE: file };
  execFileSync('bash', ['-c', `set -e
source "$NPM_PORTS_RUNTIME"
manifest_add_files "$MANIFEST_FILE" native/addon.node
manifest_remove_script "$MANIFEST_FILE" prepare missing
`], { env });
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {
    files: ['index.js', 'native/addon.node'], scripts: { build: 'tsc' },
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
});
