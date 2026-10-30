import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const bump = readFileSync('.github/workflows/bump.yml', 'utf8');
const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
const lint = readFileSync('.github/workflows/port-lint.yml', 'utf8');
const runtime = readFileSync('cli/runtime.sh', 'utf8');
const portLoader = readFileSync('cli/port.mjs', 'utf8');

test('resource metadata stays compatible with the macOS Bash 3.2 runtime', () => {
  assert.doesNotMatch(runtime, /^declare\s+-\w*g\w*\s/m);
  assert.match(portLoader, /if \[ "\$\{#resource_names\[@\]\}" -gt 0 \]; then/);
});

test('bump uses the single-port command without a third-party PR action', () => {
  assert.doesNotMatch(bump, /peter-evans|create-pull-request/);
  assert.match(bump, /cli\/npm-ports bump-pr "\$\{\{ matrix\.port \}\}"/);
  assert.match(bump, /max-parallel: 4/);
  assert.match(bump, /fail-fast: false/);
});

test('workflow display names use consistent NPMBUILD terminology', () => {
  assert.match(lint, /^name: NPMBUILD lint$/m);
  assert.match(bump, /^name: NPMBUILD bump$/m);
});

test('ready-for-review triggers both CI and port lint without a PAT', () => {
  for (const workflow of [ci, lint]) assert.match(workflow, /types: \[opened, synchronize, reopened, ready_for_review\]/);
});

test('first-time external contributors need approval before full builds', () => {
  const job = ci.slice(ci.indexOf('  external-build-approval:'), ci.indexOf('  # 对变化的 NPMBUILD port'));
  assert.match(job, /environment: external-ci/);
  assert.match(job, /FIRST_TIMER/);
  assert.match(job, /FIRST_TIME_CONTRIBUTOR/);
  assert.match(job, /github\.event\.pull_request\.head\.repo\.full_name != github\.repository/);
  assert.doesNotMatch(job, /head_ref|automation\/bump-/);
  assert.match(ci, /needs: \[detect-changes, external-build-approval\]/);
});

test('ordinary PRs build before review and only main can publish', () => {
  assert.doesNotMatch(ci, /environment: full-ci/);
  assert.match(ci, /github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
  assert.match(ci, /github\.repository == 'ohos-npm-ports\/ohos-npm-ports'/);
});

test('conclusion covers the build, approval and all five consumer platforms', () => {
  const conclusion = ci.slice(ci.indexOf('  conclusion:'));
  for (const need of ['external-build-approval', 'build-and-publish', 'consumer-install', 'consumer-install-openharmony', 'consumer-tests-windows-x64', 'consumer-tests-linux-arm64', 'consumer-tests-linux-x64', 'consumer-tests-darwin-arm64', 'consumer-tests-openharmony']) {
    assert.ok(conclusion.includes(`- ${need}`), need);
  }
  assert.match(conclusion, /GENERIC_ENABLED/);
  assert.match(conclusion, /if: always\(\)/);
});

test('selected bump writes a keyed matrix array', () => {
  assert.match(bump, /echo "ports=\$\(jq -cn --arg port "\$SELECTED" '\[\$port\]'/);
  assert.doesNotMatch(bump, /\{ports:\[\$port\]\}/);
  assert.doesNotMatch(bump, /^\s*jq .*GITHUB_OUTPUT/m);
});

test('bump does not publish to the npm registry', () => {
  assert.doesNotMatch(bump, /npm publish|cli\/npm-ports publish/);
});
