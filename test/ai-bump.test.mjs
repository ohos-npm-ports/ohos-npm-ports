import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import {
  assertPortPaths,
  assertTargetVersion,
  singlePortDirectory,
  stageRepair,
} from '../.github/scripts/ai-bump.mjs';

const workflow = readFileSync('.github/workflows/ai-bump.yml', 'utf8');
const script = readFileSync('.github/scripts/ai-bump.mjs', 'utf8');

test('AI bump accepts exactly one port including a version-line slot', () => {
  assert.equal(singlePortDirectory([
    'ports/b/bufferutil/NPMBUILD',
    'ports/b/bufferutil/patches/0001-update-package-json.patch',
  ]), 'ports/b/bufferutil');
  assert.equal(singlePortDirectory(['ports/l/lightningcss@1.32/NPMBUILD']), 'ports/l/lightningcss@1.32');
  assert.throws(() => singlePortDirectory([
    'ports/b/bufferutil/NPMBUILD',
    'ports/s/sharp/NPMBUILD',
  ]), /exactly one/);
  assert.throws(() => singlePortDirectory(['.github/workflows/ci.yml']), /one port/);
  assert.throws(() => singlePortDirectory([]), /no changed files/);
});

test('AI repair accepts any source file inside the selected port only', () => {
  assert.doesNotThrow(() => assertPortPaths([
    'ports/b/bufferutil/NPMBUILD',
    'ports/b/bufferutil/patches/new.patch',
    'ports/b/bufferutil/test.js',
    'ports/b/bufferutil/ohos/helper.cjs',
  ], 'ports/b/bufferutil'));
  assert.throws(() => assertPortPaths(['cli/build.mjs'], 'ports/b/bufferutil'), /outside/);
  assert.throws(() => assertPortPaths(['ports/b/bufferutil-other/file'], 'ports/b/bufferutil'), /outside/);
});

test('staging keeps tracked and declared source files and removes build outputs', () => {
  const root = mkdtempSync(join(tmpdir(), 'ai-bump-stage-'));
  const previous = process.cwd();
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  try {
    git('init', '-q');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.com');
    write('ports/b/bufferutil/NPMBUILD', 'version="4.0.9"\n');
    write('ports/b/bufferutil/patches/0001-update-package-json.patch', 'old patch\n');
    git('add', '.');
    git('commit', '-qm', 'initial');

    write('ports/b/bufferutil/NPMBUILD', 'version="4.1.0"\n');
    write('report/new-files/ports/b/bufferutil/patches/0002-openharmony.patch', 'new patch\n');
    write('report/new-files/ports/b/bufferutil/test.js', 'console.log("test");\n');
    write('report/new-files/ports/b/bufferutil/ohos/helper.cjs', 'module.exports = {};\n');
    write('ports/b/bufferutil/bufferutil-4.1.0/package.json', '{}\n');
    write('ports/b/bufferutil/package/package.json', '{}\n');
    write('ports/b/bufferutil/bufferutil-4.1.0.tar.gz', 'archive\n');
    write('ports/b/bufferutil/artifacts/ignored.tgz', 'artifact\n');

    process.chdir(root);
    stageRepair(
      { portDirectory: 'ports/b/bufferutil' },
      { AI_BUMP_REPORT_DIR: join(root, 'report'), GITHUB_WORKSPACE: root },
    );
    assert.deepEqual(git('diff', '--cached', '--name-only').split('\n'), [
      'ports/b/bufferutil/NPMBUILD',
      'ports/b/bufferutil/ohos/helper.cjs',
      'ports/b/bufferutil/patches/0002-openharmony.patch',
      'ports/b/bufferutil/test.js',
    ]);
    assert.deepEqual(git('status', '--porcelain', '--', 'ports/b/bufferutil').split('\n'), [
      'M  ports/b/bufferutil/NPMBUILD',
      'A  ports/b/bufferutil/ohos/helper.cjs',
      'A  ports/b/bufferutil/patches/0002-openharmony.patch',
      'A  ports/b/bufferutil/test.js',
    ]);
  } finally {
    process.chdir(previous);
    rmSync(root, { recursive: true, force: true });
  }
});

test('AI repair cannot fix a bump by restoring the old version', () => {
  assert.doesNotThrow(() => assertTargetVersion({ version: '4.1.0' }, { version: '4.1.0' }));
  assert.throws(() => assertTargetVersion({ version: '4.1.0' }, { version: '4.0.9' }), /target version/);
});

test('AI bump is a label-triggered same-repository workflow without status labels', () => {
  assert.match(workflow, /types: \[labeled\]/);
  assert.match(workflow, /github\.event\.label\.name == 'request-ai-bump'/);
  assert.match(workflow, /head\.repo\.full_name == github\.repository/);
  assert.doesNotMatch(workflow, /pull_request_target|workflow_run/);
  assert.doesNotMatch(workflow, /ai-running|ai-success|ai-failed/);
  assert.match(workflow, /group: ai-bump-pr-/);
});

test('AI credentials are scoped to their respective steps', () => {
  const repair = workflow.slice(workflow.indexOf('- name: Repair the port'), workflow.indexOf('- name: Independently verify'));
  const publish = workflow.slice(workflow.indexOf('- name: Amend and push'));
  assert.match(repair, /DEEPSEEK_API_KEY/);
  assert.doesNotMatch(repair, /GH_TOKEN|app-token/);
  assert.match(publish, /GH_TOKEN: \$\{\{ steps\.app-token\.outputs\.token \}\}/);
  assert.doesNotMatch(publish, /DEEPSEEK_API_KEY/);
  assert.match(workflow, /persist-credentials: false/);
});

test('publishing applies the verified patch in a fresh clone', () => {
  assert.match(script, /'clone', '--depth', '2', '--branch', state\.headRef/);
  assert.match(script, /'apply', '--index', '--whitespace=error-all', state\.patch/);
  assert.match(script, /force-with-lease=refs\/heads\/\$\{state\.headRef\}:\$\{state\.headSha\}/);
  const publish = script.slice(script.indexOf('function publish'), script.indexOf('function finalize'));
  assert.doesNotMatch(publish, /AI_BUMP_PUSH_TOKEN|DEEPSEEK_API_KEY/);
});

test('AI containers configure PATH and use the documented npm-ports command', () => {
  const prompt = script.slice(script.indexOf('function promptFor'), script.indexOf('function repair'));
  const repair = script.slice(script.indexOf('function repair'), script.indexOf('function stageRepair'));
  const verify = script.slice(script.indexOf('function verify'), script.indexOf('function comment'));
  assert.match(prompt, /npm-ports lint \$\{state\.portDirectory\}/);
  assert.match(prompt, /npm-ports check \$\{state\.portDirectory\}/);
  assert.doesNotMatch(prompt, /cli\/npm-ports/);
  assert.match(repair, /export PATH="\/workspace\/cli:\$PATH"/);
  assert.match(verify, /export PATH="\/workspace\/cli:\$PATH"/);
  assert.match(verify, /npm-ports lint "\$1" && npm-ports check "\$1"/);
});

test('AI restores report ownership before the host reads it', () => {
  const repair = script.slice(script.indexOf('function repair'), script.indexOf('function stageRepair'));
  const docker = repair.indexOf("run('docker'");
  const restore = repair.indexOf('restoreOwnership(env);', docker);
  const read = repair.indexOf('readIfPresent(reportPath)', docker);
  assert.ok(docker >= 0 && restore > docker && read > restore);
  assert.match(repair, /finally \{\s*restoreOwnership\(env\);/);
});
