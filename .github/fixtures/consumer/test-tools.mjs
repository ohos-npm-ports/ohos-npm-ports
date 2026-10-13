import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { installedPackage } from '../../scripts/installed-package.mjs';

const local = createRequire(join(process.cwd(), 'package.json'));
export function packageRoot(name, resolver = local) { return dirname(installedPackage(resolver, name).path); }
export function bin(name, key) {
  const { path, manifest } = installedPackage(local, name);
  const value = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[key ?? name.split('/').at(-1)];
  assert.equal(typeof value, 'string', `Missing CLI ${name}/${key ?? ''}`);
  return join(dirname(path), value);
}
export function command(executable, args, options = {}) {
  const { codes = [0], ...rest } = options;
  const result = spawnSync(executable, args, { encoding: 'utf8', timeout: 120000, ...rest });
  assert.ifError(result.error);
  assert.ok(codes.includes(result.status), `${executable} ${args.join(' ')}: ${result.status}\n${result.stdout}\n${result.stderr}`);
  return { ...result, output: result.stdout + result.stderr };
}
export function cli(name, args, options = {}, key) {
  const path = bin(name, key);
  const header = readFileSync(path).subarray(0, 4);
  const native = header.toString('hex') === '7f454c46' || header.subarray(0, 2).toString() === 'MZ';
  return native ? command(path, args, options) : command(process.execPath, [path, ...args], options);
}
export function write(path, contents) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, contents); }
export function report(result, assets = []) { writeFileSync(process.env.PORT_TEST_REPORT, JSON.stringify({ result, assets })); }
export function bunScript(source) {
  const path = join(process.cwd(), '.port-tests/runtime-probe.mjs');
  write(path, source);
  return command(bin('bun'), [path]);
}
