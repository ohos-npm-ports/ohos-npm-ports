import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { artifactFilename, packageName } from '../cli/validate-publish.mjs';

test('package specs preserve scoped and unscoped package names', () => {
  assert.equal(packageName('demo@1.2.3'), 'demo');
  assert.equal(packageName('@scope/demo@1.2.3'), '@scope/demo');
  assert.equal(packageName('@ohos-npm-ports/demo@1.2.3-4'), '@ohos-npm-ports/demo');
});

test('artifact filenames match npm pack naming', () => {
  assert.equal(artifactFilename({ name: 'demo', version: '1.2.3' }), 'demo-1.2.3.tgz');
  assert.equal(artifactFilename({ name: '@scope/demo', version: '1.2.3-4' }), 'scope-demo-1.2.3-4.tgz');
});

test('validate-publish is exposed as an npm-ports command', () => {
  const output = execFileSync('cli/npm-ports', ['--help'], { encoding: 'utf8' });
  assert.match(output, /validate-publish <port>/);
});
