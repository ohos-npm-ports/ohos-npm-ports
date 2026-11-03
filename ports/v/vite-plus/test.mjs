import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { verifyCoreResolution } from './verify-core.mjs';

export default function test({ requirePackage, resolvePackage, mode }) {
  const root = dirname(resolvePackage('vite-plus/package.json'));
  const binding = requirePackage(resolve(root, 'binding/index.cjs'));
  assert.equal(typeof binding.run, 'function');
  assert.equal(typeof binding.runCommand, 'function');
  const output = execFileSync(process.execPath, [resolve(root, 'bin/vp'), '--version'], { encoding: 'utf8', timeout: 30000 });
  assert.match(output, /1\.4\.0/);
  verifyCoreResolution(root, mode);
  return { result: { coreResolution: true }, assets: [] };
}
