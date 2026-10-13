import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
const step = (name) => {
  const start = workflow.indexOf(`      - name: ${name}`);
  assert.ok(start >= 0, `Missing step: ${name}`);
  const end = workflow.indexOf('\n      - ', start + 1);
  return workflow.slice(start, end > 0 ? end : undefined);
};

test('temporary publishing and artifact upload apply to every build event', () => {
  for (const name of ['Validate publish through temporary Verdaccio', 'Upload exact pre-release packages']) {
    assert.doesNotMatch(step(name), /if: github.event_name/);
  }
});

test('build step runs ./build.sh after brew update with the brew rust first on PATH', () => {
  const build = step('Build');
  assert.match(build, /\.\/build\.sh/);
  assert.match(build, /HOMEBREW_NO_AUTO_UPDATE: "1"/);
  assert.match(build, /HOMEBREW_NO_INSTALL_UPGRADE: "1"/);
  assert.match(build, /brew update/);
  assert.match(build, /brew --prefix rust/);
  assert.doesNotMatch(build, /setup-ci-runner|sh -ex|brew (install|upgrade)/);
});

test('publish runs only for pushes to main of the upstream repository', () => {
  const publish = step('Publish');
  assert.match(publish, /github\.event_name == 'push'/);
  assert.match(publish, /github\.ref == 'refs\/heads\/main'/);
  assert.match(publish, /github\.repository == 'ohos-npm-ports\/ohos-npm-ports'/);
});

test('only pull_request runs share a concurrency group', () => {
  const block = workflow.slice(workflow.indexOf('\nconcurrency:'), workflow.indexOf('\njobs:'));
  assert.match(block, /github\.run_id/);
  assert.match(block, /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/);
  assert.doesNotMatch(block, /github\.ref\b/);
});

test('tool versions are exact', () => {
  const versions = JSON.parse(readFileSync('.github/scripts/tool-versions.json', 'utf8'));
  assert.ok(Object.keys(versions).length > 0);
  for (const [name, version] of Object.entries(versions)) assert.match(version, /^\d+\.\d+\.\d+$/, name);
});

test('workflow files that change the build are in the pull_request paths', () => {
  const block = workflow.slice(workflow.indexOf('  pull_request:'), workflow.indexOf('\npermissions:'));
  for (const file of ['.github/workflows/ci.yml', '.github/scripts/validate-local-publish.sh', '.github/scripts/tool-versions.json', '.github/scripts/ci-workflow.test.mjs']) {
    assert.ok(block.includes(`"${file}"`), file);
  }
});
