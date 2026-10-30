const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { readFileSync, realpathSync } = require('node:fs');
const { createRequire } = require('node:module');
const { resolve } = require('node:path');

for (const directory of ['.', 'vite', 'vite/packages/vite', 'packages/prompts', 'packages/cli', 'packages/core']) {
  const from = createRequire(resolve(directory, 'package.json'));
  const manifest = from('typescript/package.json');
  assert.equal(manifest.name, '@ohos-npm-ports/typescript', directory);
  assert.equal(manifest.version, '7.0.2-3', directory);
}
const shim = readFileSync('vite/packages/vite/node_modules/.bin/tsc', 'utf8');
assert.match(shim, /@ohos-npm-ports/);
const output = execFileSync('pnpm', ['--filter', 'vite', 'exec', 'tsc', '--version'], {
  encoding: 'utf8', timeout: 30000,
});
assert.match(output, /Version 7\.0\.2/);
for (const directory of ['packages/prompts', 'packages/cli', 'packages/core']) {
  const from = createRequire(resolve(directory, 'package.json'));
  const fromTsdown = createRequire(from.resolve('tsdown'));
  const fromDts = createRequire(fromTsdown.resolve('rolldown-plugin-dts'));
  assert.equal(fromDts('typescript/package.json').name, '@ohos-npm-ports/typescript', directory);
}
const fromNapi = createRequire(realpathSync('node_modules/@napi-rs/cli/package.json'));
const compiler = fromNapi('typescript');
assert.equal(compiler.version, '6.0.3');
assert.equal(typeof compiler.ScriptTarget.Latest, 'number');
assert.equal(typeof compiler.createProgram, 'function');
console.log('OK: community tsc entry and napi-rs compiler API');
