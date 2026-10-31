import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
const job = (name) => {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `Missing job: ${name}`);
  const end = workflow.slice(start + 1).search(/\n  [a-z][a-z-]*:\n/);
  return workflow.slice(start, end >= 0 ? start + 1 + end : undefined);
};
const step = (name, from = workflow) => {
  const start = from.indexOf(`      - name: ${name}`);
  assert.ok(start >= 0, `Missing step: ${name}`);
  const end = from.indexOf('\n      - ', start + 1);
  return from.slice(start, end > 0 ? end : undefined);
};

test('temporary publishing and artifact upload apply to every build event', () => {
  for (const name of ['Validate publish through temporary Verdaccio', 'Upload exact pre-release packages']) {
    assert.doesNotMatch(step(name), /if: github.event_name/);
  }
});

test('build step runs the build script, so editing ci.yml alone cannot change a build', () => {
  const build = step('Build', job('build'));
  assert.match(build, /run: sh \.github\/scripts\/build-port\.sh "\$\{\{ matrix\.dir \}\}"/);
  assert.doesNotMatch(build, /env:|brew|HOMEBREW|PATH/);
  assert.doesNotMatch(job('build'), /brew update|HOMEBREW_NO/);
});

test('the build script updates brew, puts the brew rust first on PATH and then checks the port', () => {
  const script = readFileSync('.github/scripts/build-port.sh', 'utf8');
  assert.match(script, /export HOMEBREW_NO_AUTO_UPDATE=1/);
  assert.match(script, /export HOMEBREW_NO_INSTALL_UPGRADE=1/);
  assert.ok(script.indexOf('brew update') < script.indexOf('brew --prefix rust'));
  assert.ok(script.indexOf('brew --prefix rust') < script.indexOf('cli/npm-ports check "$1"'));
  assert.doesNotMatch(script, /python_bin|PYTHON|setup-ci-runner|brew (install|upgrade)/);
});

test('ports that need a build and ports fetched from npm run in separate matrices', () => {
  assert.match(job('build'), /matrix:\n\s+dir: \$\{\{ fromJson\(needs\.detect-changes\.outputs\.build-matrix\) \}\}/);
  assert.match(job('build'), /outputs\.build-matrix != '\[\]'/);
  const fetch = job('fetch');
  assert.match(fetch, /matrix:\n\s+dir: \$\{\{ fromJson\(needs\.detect-changes\.outputs\.fetch-matrix\) \}\}/);
  assert.match(fetch, /outputs\.fetch-matrix != '\[\]'/);
  assert.match(fetch, /needs: \[detect-changes, external-build-approval\]/);
  assert.doesNotMatch(fetch, /container:|secrets\.|NPM_TOKEN|npm-ports publish/);
  assert.match(step('Download the published tarballs', fetch), /fetch-published\.mjs "\$\{\{ matrix\.dir \}\}"/);
  assert.match(step('Upload published packages', fetch), /name: \$\{\{ steps\.published\.outputs\.artifact-name \}\}/);
});

test('consumers start once build and fetch are both finished, behind the same first-time contributor approval', () => {
  const gate = job('artifacts');
  assert.match(gate, /needs: \[detect-changes, external-build-approval, build, fetch\]/);
  assert.match(gate, /external-build-approval\.result == 'success' \|\| needs\.external-build-approval\.result == 'skipped'/);
  assert.match(gate, /needs\.build\.result == 'success' \|\| needs\.build\.result == 'failure' \|\| needs\.detect-changes\.outputs\.build-matrix == '\[\]'/);
  assert.match(gate, /needs\.fetch\.result == 'success' \|\| needs\.fetch\.result == 'failure' \|\| needs\.detect-changes\.outputs\.fetch-matrix == '\[\]'/);
  const consumers = [...workflow.matchAll(/^  (consumer-[a-z0-9-]+):\n/gm)].map((match) => match[1]);
  assert.equal(consumers.length, 7);
  for (const name of consumers) {
    const body = job(name);
    assert.match(body, /needs: \[detect-changes, artifacts\]/, name);
    assert.match(body, /needs\.artifacts\.result == 'success'/, name);
    assert.doesNotMatch(body, /needs\.build\b/, name);
  }
});

test('the replayed run clears both matrices', () => {
  const detect = step('Find changed NPMBUILD ports');
  assert.match(detect, /echo 'build-matrix=\[\]'/);
  assert.match(detect, /echo 'fetch-matrix=\[\]'/);
  assert.match(detect, /REGISTRY_CHECK: 'true'/);
});

test('the build job never publishes and never sees the npm token', () => {
  const build = job('build');
  assert.doesNotMatch(build, /NPM_TOKEN|npm-ports publish|name: Publish/);
  assert.doesNotMatch(workflow, /build-and-publish/);
});

test('publish is a separate job that waits for the complete CI result', () => {
  const publish = job('publish');
  assert.match(publish, /needs: \[detect-changes, conclusion\]/);
  assert.match(publish, /needs\.conclusion\.result == 'success'/);
  assert.doesNotMatch(publish, /always\(\)/);
  assert.match(publish, /github\.event_name == 'push'/);
  assert.match(publish, /github\.ref == 'refs\/heads\/main'/);
  assert.match(publish, /github\.repository == 'ohos-npm-ports\/ohos-npm-ports'/);
  assert.match(publish, /needs\.detect-changes\.outputs\.publish != '\[\]'/);
});

test('publish uploads the tarballs verified in this run, in dependency order', () => {
  const publish = job('publish');
  assert.match(publish, /download-artifact@v8/);
  assert.match(publish, /pattern: port-\*/);
  assert.doesNotMatch(publish, /run-id:/);
  const command = step('Publish verified tarballs', publish);
  assert.match(command, /outputs\.publish-order/);
  assert.match(command, /cli\/npm-ports publish "\$dir" --skip-existing --expect-sha "\$GITHUB_SHA"/);
});

test('the npm token is written to a file and absent from the step that runs NPMBUILD code', () => {
  const publish = job('publish');
  assert.match(step('Write npm credentials', publish), /NPM_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}/);
  assert.doesNotMatch(step('Publish verified tarballs', publish), /NPM_TOKEN|NODE_AUTH_TOKEN/);
  assert.equal([...workflow.matchAll(/secrets\.NPM_TOKEN/g)].length, 1);
});

test('conclusion does not wait for publish, so pull requests can require it', () => {
  assert.doesNotMatch(job('conclusion'), /- publish\b/);
});

test('the publish list is judged against npm on pushes only', () => {
  const detect = step('Find changed NPMBUILD ports');
  assert.match(detect, /PUBLISH_CHECK: \$\{\{ github\.event_name == 'push' && 'true' \|\| 'false' \}\}/);
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

test('workflow files that change the build are in both push and pull_request paths', () => {
  const blocks = [
    workflow.slice(workflow.indexOf('  push:'), workflow.indexOf('  pull_request:')),
    workflow.slice(workflow.indexOf('  pull_request:'), workflow.indexOf('\npermissions:')),
  ];
  for (const block of blocks) {
    for (const file of ['.github/workflows/ci.yml', '.github/scripts/build-port.sh', '.github/scripts/validate-local-publish.sh', '.github/scripts/tool-versions.json', '.github/scripts/ci-workflow.test.mjs']) {
      assert.ok(block.includes(`"${file}"`), file);
    }
    for (const directory of ['cli', 'test']) assert.ok(block.includes(`"${directory}/**"`), directory);
  }
});
