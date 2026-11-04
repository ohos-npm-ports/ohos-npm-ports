import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { chooseTag, packPort, publishPort, runLifecycle, normalizePackages } from '../cli/build.mjs';
import { bumpPorts, updatePortText } from '../cli/bump.mjs';
import { bumpPr } from '../cli/bump-pr.mjs';
import { createPort } from '../cli/create.mjs';
import { executeConsumerTest } from '../cli/consumer-test-runner.mjs';
import { lintPort, lintPublishedNames } from '../cli/lint.mjs';
import { loadPort } from '../cli/port.mjs';
import { distTagVersion, publishedIntegrity } from '../cli/registry.mjs';
import { compareSemver, inVersionLine } from '../cli/semver.mjs';
import { unbumpedPorts } from '../cli/unbumped.mjs';
import { findAarch64ElfFiles, signPackages } from '../cli/sign.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'npm-ports-test-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  const dir = join(root, 'ports', 'd', 'demo');
  mkdirSync(join(dir, 'build', 'main'), { recursive: true });
  mkdirSync(join(dir, 'slots', 'demo', 'build', 'slot'), { recursive: true });
  writeFileSync(join(dir, 'NPMBUILD'), `pkgname="demo"\nupstream="demo"\nversion="1.2.3"\nrevision=4\ndist_tag="latest"\npackages=("@ohos-npm-ports/demo-openharmony-arm64:slots/demo/build/slot" "build/main")\nbuild() { :; }\n`);
  writeFileSync(join(dir, 'build', 'main', 'package.json'), JSON.stringify({
    name: 'demo', version: '1.2.3',
    optionalDependencies: { '@upstream/slot': 'npm:@ohos-npm-ports/demo-openharmony-arm64@1.2.3' },
  }));
  writeFileSync(join(dir, 'slots', 'demo', 'build', 'slot', 'package.json'), JSON.stringify({ version: '1.2.3' }));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, dir };
}

test('semver comparison and version lines', () => {
  assert.ok(compareSemver('1.10.0', '1.2.0') > 0);
  assert.ok(compareSemver('2.0.0', '2.0.0-rc.1') > 0);
  assert.ok(compareSemver('2.0.0-rc.2', '2.0.0-rc.10') < 0);
  assert.equal(inVersionLine('14.2.31', '14'), true);
  assert.equal(inVersionLine('15.0.0', '14'), false);
});

test('npm-ports is directly executable through its shebang', () => {
  const output = execFileSync('cli/npm-ports', ['info', 'bufferutil'], { encoding: 'utf8' });
  assert.match(output, /^bufferutil: bufferutil /);
});

test('option values are not mistaken for a port', () => {
  const output = execFileSync('cli/npm-ports', ['info', '--base', 'testing', 'bufferutil'], { encoding: 'utf8' });
  assert.match(output, /^bufferutil: bufferutil /);
});

test('edit opens the selected NPMBUILD with vim or the configured editor', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'npm-ports-editor-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const log = join(root, 'editor.log');
  for (const name of ['vim', 'custom-editor']) {
    writeFileSync(join(root, name), '#!/bin/sh\nprintf \'%s\\n\' "$1" >> "$EDIT_LOG"\n');
    execFileSync('chmod', ['+x', join(root, name)]);
  }
  const env = { ...process.env, PATH: `${root}:${process.env.PATH ?? ''}`, EDIT_LOG: log, VISUAL: '', EDITOR: '' };
  execFileSync('cli/npm-ports', ['edit', 'lightningcss@1.32'], { env });
  env.EDITOR = 'custom-editor';
  execFileSync('cli/npm-ports', ['edit', 'bufferutil'], { env });
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), [
    join(process.cwd(), 'ports/l/lightningcss@1.32/NPMBUILD'),
    join(process.cwd(), 'ports/b/bufferutil/NPMBUILD'),
  ]);
  assert.throws(() => execFileSync('cli/npm-ports', ['edit', '--all'], { env, stdio: 'pipe' }), /edit accepts exactly one port/);
});

test('create derives scoped names and fetches version and source checksum', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'npm-ports-create-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = 'https://registry.npmjs.org/@scope/demo/-/demo-1.2.3.tgz';
  const execute = (command, args) => {
    assert.equal(args[1], '@scope/demo');
    return JSON.stringify({ name: '@scope/demo', version: '1.2.3', 'dist.tarball': source });
  };
  const port = await createPort(root, '@scope/demo', { execute, download: async () => 'a'.repeat(64) });
  assert.equal(port.pkgname, 'scope-demo');
  assert.equal(port.relative, 'ports/s/scope-demo/NPMBUILD');
  const text = readFileSync(port.file, 'utf8');
  assert.match(text, /upstream="@scope\/demo"/);
  assert.match(text, /version="1.2.3"/);
  assert.match(text, new RegExp(`sha256="${'a'.repeat(64)}"`));
  assert.doesNotThrow(() => loadPort(root, port.dir));
  await assert.rejects(createPort(root, '@scope/demo', { execute, download: async () => 'a'.repeat(64) }), /port already exists/);
});

test('create supports no-fetch and opens the generated NPMBUILD', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'npm-ports-create-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const log = join(root, 'editor.log');
  writeFileSync(join(root, 'vim'), '#!/bin/sh\nprintf \'%s\\n\' "$1" > "$EDIT_LOG"\n');
  execFileSync('chmod', ['+x', join(root, 'vim')]);
  const env = { ...process.env, PATH: `${root}:${process.env.PATH ?? ''}`, NPM_PORTS_ROOT: root, EDIT_LOG: log, VISUAL: '', EDITOR: '' };
  const output = execFileSync('cli/npm-ports', ['create', '@scope/demo', '--set-name=custom-demo', '--set-version=1.2.3', '--no-fetch'], { env, encoding: 'utf8' });
  const file = join(root, 'ports/c/custom-demo/NPMBUILD');
  const text = readFileSync(file, 'utf8');
  assert.match(text, /pkgname="custom-demo"/);
  assert.match(text, /version="1.2.3"/);
  assert.match(text, /sha256=""/);
  assert.match(text, /demo-\$\{version\}\.tgz/);
  assert.match(text, /extract_source "\$NPMBUILD_WORK_DIR\/\$\{pkgname\}-\$\{version\}"/);
  assert.doesNotMatch(text, /curl|sha256sum/);
  assert.match(output, /Fill in version and sha256/);
  assert.equal(readFileSync(log, 'utf8').trim(), file);
});

test('loadPort reads Bash metadata and rejects invalid output paths', (t) => {
  const { root, dir } = fixture(t);
  const port = loadPort(root, dir);
  assert.equal(port.portVersion, '1.2.3-4');
  assert.deepEqual(port.packages, ['slots/demo/build/slot', 'build/main']);
  assert.deepEqual(port.packageNames, ['@ohos-npm-ports/demo-openharmony-arm64', '']);
  const versioned = join(root, 'ports', 'd', 'demo@1.2');
  mkdirSync(versioned);
  const file = join(versioned, 'NPMBUILD');
  writeFileSync(file, 'pkgname="demo"\nupstream="demo"\nversion="1.2.3"\nrevision=1\ndist_tag="latest"\npackages=("build/main")\nbuild() { :; }\n');
  assert.throws(() => loadPort(root, versioned), /must not publish to latest/);
  writeFileSync(file, readFileSync(file, 'utf8').replace('dist_tag="latest"', 'dist_tag="legacy"').replace('packages=("build/main")', 'packages=("main")'));
  assert.throws(() => loadPort(root, versioned), /package output must be inside build/);
});

test('published short names reject collisions between different upstream scopes', () => {
  assert.throws(() => lintPublishedNames([
    { pkgname: 'foo-bar-baz', upstream: '@foo/bar-baz' },
    { pkgname: 'foo-bar-baz', upstream: '@foo-bar/baz' },
  ]), /maps to multiple upstream packages/);
  assert.doesNotThrow(() => lintPublishedNames([
    { pkgname: 'foo-bar-baz', upstream: '@foo/bar-baz' },
    { pkgname: 'foo-bar-baz', upstream: '@foo/bar-baz' },
  ]));
});

test('normalization injects final manifests and is idempotent', (t) => {
  const { root, dir } = fixture(t);
  const port = loadPort(root, dir);
  normalizePackages(port);
  normalizePackages(port);
  const main = JSON.parse(readFileSync(join(dir, 'build', 'main', 'package.json')));
  const slot = JSON.parse(readFileSync(join(dir, 'slots', 'demo', 'build', 'slot', 'package.json')));
  assert.equal(main.name, '@ohos-npm-ports/demo');
  assert.equal(slot.name, '@ohos-npm-ports/demo-openharmony-arm64');
  assert.equal(main.version, '1.2.3-4');
  assert.equal(slot.version, '1.2.3-4');
  assert.equal(main.optionalDependencies['@upstream/slot'], 'npm:@ohos-npm-ports/demo-openharmony-arm64@1.2.3-4');
  assert.equal(main.repository.url, 'git+https://github.com/ohos-npm-ports/ohos-npm-ports.git');
  assert.equal(main.repository.directory, 'ports/d/demo');
  writeFileSync(join(dir, 'build', 'main', 'package.json'), JSON.stringify({ ...main, version: '1.2.4' }));
  assert.throws(() => normalizePackages(port), /must start from upstream 1\.2\.3 or normalized 1\.2\.3-4/);
});

test('lifecycle automatically runs prerequisites and isolates slot hooks', (t) => {
  const { root, dir } = fixture(t);
  const file = join(dir, 'NPMBUILD');
  const hooks = (prefix) => ['prepare', 'build', 'package'].map((phase) => {
    const environment = !prefix && phase === 'build' ? 'export NPM_PORTS_TEST_ENV=ready; '
      : phase === 'package' ? (prefix ? 'test -z "${NPM_PORTS_TEST_ENV:-}"; ' : 'test "$NPM_PORTS_TEST_ENV" = ready; ') : '';
    return `${prefix}${phase}() { ${environment}test "$PWD" = "$NPMBUILD_SLOT_DIR"; test "$NPMBUILD_WORK_DIR" = "$NPMBUILD_SLOT_DIR/build"; test -d "$NPMBUILD_WORK_DIR"; printf '%s\\n' '${prefix}${phase}' >> "$NPMBUILD_DIR/lifecycle.log"; }`;
  }).join('\n');
  writeFileSync(file, `${readFileSync(file, 'utf8')}\n${hooks('')}\n${hooks('slot_demo_')}\n`);
  runLifecycle(loadPort(root, dir), 'package');
  const main = JSON.parse(readFileSync(join(dir, 'build', 'main', 'package.json')));
  assert.equal(main.name, '@ohos-npm-ports/demo');
  assert.equal(main.version, '1.2.3-4');
  assert.equal(main.optionalDependencies['@upstream/slot'], 'npm:@ohos-npm-ports/demo-openharmony-arm64@1.2.3-4');
  assert.equal(JSON.parse(readFileSync(join(dir, 'slots', 'demo', 'build', 'slot', 'package.json'))).name, '@ohos-npm-ports/demo-openharmony-arm64');
  assert.equal(JSON.parse(readFileSync(join(dir, 'slots', 'demo', 'build', 'slot', 'package.json'))).version, '1.2.3-4');
  assert.deepEqual(readFileSync(join(dir, 'lifecycle.log'), 'utf8').trim().split('\n'), [
    'prepare', 'build', 'package',
    'slot_demo_prepare', 'slot_demo_build', 'slot_demo_package',
  ]);
});

test('clean removes main and slot outputs without removing sources or download cache', (t) => {
  const { root, dir } = fixture(t);
  const cacheFile = join(root, 'cache', 'downloads', 'source.tgz');
  const slotSource = join(dir, 'slots', 'demo', 'patches', 'fix.patch');
  mkdirSync(join(dir, 'artifacts'), { recursive: true });
  mkdirSync(join(cacheFile, '..'), { recursive: true });
  mkdirSync(join(slotSource, '..'), { recursive: true });
  writeFileSync(cacheFile, 'cached');
  writeFileSync(slotSource, 'patch');
  execFileSync('cli/npm-ports', ['clean', dir], { env: { ...process.env, NPM_PORTS_ROOT: root } });
  assert.equal(existsSync(join(dir, 'build')), false);
  assert.equal(existsSync(join(dir, 'slots', 'demo', 'build')), false);
  assert.equal(existsSync(join(dir, 'artifacts')), false);
  assert.equal(readFileSync(cacheFile, 'utf8'), 'cached');
  assert.equal(readFileSync(slotSource, 'utf8'), 'patch');
  assert.equal(existsSync(join(dir, 'NPMBUILD')), true);
});

test('consumer test runner provides package context and writes the returned report', async (t) => {
  const projectDir = mkdtempSync(join(tmpdir(), 'npm-ports-consumer-test-'));
  t.after(() => rmSync(projectDir, { recursive: true, force: true }));
  mkdirSync(join(projectDir, 'node_modules/consumer-deps'), { recursive: true });
  mkdirSync(join(projectDir, 'node_modules/example'), { recursive: true });
  writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'project', version: '1.0.0' }));
  writeFileSync(join(projectDir, 'node_modules/consumer-deps/package.json'), JSON.stringify({ name: 'consumer-deps', version: '1.0.0', main: 'index.cjs' }));
  writeFileSync(join(projectDir, 'node_modules/consumer-deps/index.cjs'), 'module.exports = {};\n');
  writeFileSync(join(projectDir, 'node_modules/example/package.json'), JSON.stringify({
    name: 'example', version: '1.2.3', type: 'module', exports: { '.': './index.js', './package.json': './package.json' },
  }));
  writeFileSync(join(projectDir, 'node_modules/example/index.js'), 'export const answer = 42;\n');
  const file = join(projectDir, 'test.mjs');
  const report = join(projectDir, 'report.json');
  writeFileSync(file, `import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
export function setup({ projectDir, version }) { writeFileSync(projectDir + '/setup.txt', version); }
export default async function test(context) {
  const { answer } = await context.importPackage('example');
  assert.equal(answer, 42);
  assert.equal(context.requirePackage('example/package.json').version, '1.2.3');
  assert.ok(context.resolvePackage('example/package.json').endsWith('package.json'));
  assert.equal(context.tools('./package.json').name, 'consumer-deps');
  assert.equal(context.run(process.execPath, ['-e', 'console.log("ok")'], { capture: true }).stdout.trim(), 'ok');
  return { result: { answer, mode: context.mode, version: context.version, revision: context.revision }, assets: [] };
}
`);
  await executeConsumerTest({ file, phase: 'setup', version: '1.2.3', projectDir });
  assert.equal(readFileSync(join(projectDir, 'setup.txt'), 'utf8'), '1.2.3');
  const result = await executeConsumerTest({ file, mode: 'overrides', version: '1.2.3', revision: 4, projectDir, report });
  assert.deepEqual(result.result, { answer: 42, mode: 'overrides', version: '1.2.3', revision: 4 });
  assert.deepEqual(JSON.parse(readFileSync(report, 'utf8')), result);
});

test('lifecycle preserves early-exit pipeline behavior', (t) => {
  const { root, dir } = fixture(t);
  const file = join(dir, 'NPMBUILD');
  writeFileSync(file, readFileSync(file, 'utf8').replace('build() { :; }', 'build() { yes | head -n 1 >/dev/null; }'));
  assert.doesNotThrow(() => runLifecycle(loadPort(root, dir), 'build'));
});

test('lint enforces version metadata and unique declarations', (t) => {
  const { root, dir } = fixture(t);
  const port = loadPort(root, dir);
  const file = join(dir, 'NPMBUILD');
  const source = readFileSync(file, 'utf8');
  writeFileSync(file, `${source}VERSION=1.2.3\n`);
  assert.throws(() => lintPort(port), /version literals must reference the version metadata/);
  writeFileSync(file, `${source}VERSION="\${version}"\n`);
  assert.throws(() => lintPort(port), /legacy metadata alias VERSION/);
  writeFileSync(file, `foo=1\nfoo=2\n${source}`);
  assert.throws(() => lintPort(port), /duplicate global assignment foo/);
  writeFileSync(file, `${source}version="\${version}"\n`);
  assert.throws(() => lintPort(port), /metadata alias version is redundant/);
  const hash = 'a'.repeat(64);
  writeFileSync(file, `${source}${hash}\n${hash}\n`);
  assert.throws(() => lintPort(port), /duplicate SHA-256 literal/);
});

test('lint separates current port revisions from cross-port dependency pins', (t) => {
  const { root, dir } = fixture(t);
  const port = loadPort(root, dir);
  const file = join(dir, 'NPMBUILD');
  const patches = join(dir, 'patches');
  const patch = join(patches, '0001-test.patch');
  mkdirSync(patches);
  writeFileSync(file, `${readFileSync(file, 'utf8')}# 0001-test.patch\n`);
  writeFileSync(patch, '--- a/package.json\n+++ b/package.json\n@@ -1 +1 @@\n-  "version": "1.2.3"\n+  "version": "1.2.3-4"\n');
  assert.throws(() => lintPort(port), /must not change package\.json version/);
  writeFileSync(patch, '--- a/package.json\n+++ b/package.json\n@@ -1,2 +1,2 @@\n {\n   "version": "1.2.3"\n');
  assert.throws(() => lintPort(port), /must not pin upstream version context/);
  writeFileSync(patch, '--- a/package.json\n+++ b/package.json\n@@ -1 +1 @@\n-  "name": "demo"\n+  "name": "@ohos-npm-ports/demo"\n');
  assert.throws(() => lintPort(port), /package names are injected by npm-ports/);
  writeFileSync(patch, '--- a/package.json\n+++ b/package.json\n@@ -1 +1 @@\n-  "description": "demo"\n+  "description": "demo port"\n');
  assert.throws(() => lintPort(port), /must not change package\.json description/);
  writeFileSync(patch, '--- a/package.json\n+++ b/package.json\n@@ -1 +1 @@\n-  "repository": "upstream"\n+  "repository": "fork"\n');
  assert.throws(() => lintPort(port), /repository URL and directory are injected/);
  writeFileSync(patch, '--- a/package.json\n+++ b/package.json\n@@ -1,5 +1,5 @@\n   "repository": {\n     "type": "git",\n-    "url": "upstream"\n+    "url": "fork"\n   },\n');
  assert.throws(() => lintPort(port), /repository URL and directory are injected/);
  writeFileSync(patch, '--- a/package.json\n+++ b/package.json\n@@ -1,5 +1,5 @@\n   "bugs": {\n-    "url": "upstream"\n+    "url": "fork"\n   },\n');
  assert.doesNotThrow(() => lintPort(port));
  writeFileSync(patch, '--- a/package.json\n+++ b/package.json\n@@ -1 +1 @@\n-  "other": "1.2.3"\n+  "other": "npm:@ohos-npm-ports/other@1.2.3-7"\n');
  assert.doesNotThrow(() => lintPort(port));
  writeFileSync(patch, '--- a/package.json\n+++ b/package.json\n@@ -1 +1 @@\n-  "slot": "1.2.3"\n+  "slot": "npm:@ohos-npm-ports/demo-openharmony-arm64@1.2.3-7"\n');
  assert.throws(() => lintPort(port), /current port revisions/);
  writeFileSync(file, `${readFileSync(file, 'utf8')}port_version="\${version}-2"\n`);
  assert.throws(() => lintPort(port), /use bare upstream version/);
});

test('lint rejects zero-context insertions into existing files', (t) => {
  const { root, dir } = fixture(t);
  const file = join(dir, 'NPMBUILD');
  const patches = join(dir, 'patches');
  const patch = join(patches, '0001-test.patch');
  const port = loadPort(root, dir);
  mkdirSync(patches);
  writeFileSync(file, `${readFileSync(file, 'utf8')}# 0001-test.patch\n`);
  writeFileSync(patch, '--- a/src/index.js\n+++ b/src/index.js\n@@ -999,0 +1000,1 @@\n+unexpected\n');
  assert.throws(() => lintPort(port), /zero-context insertion into an existing file/);
  writeFileSync(patch, '--- a/src/new.js\n+++ b/src/new.js\n@@ -0,0 +1,1 @@\n+expected\n');
  assert.doesNotThrow(() => lintPort(port));
});

test('pack and dry-run publish use exact versioned artifacts', (t) => {
  const { root, dir } = fixture(t);
  const port = loadPort(root, dir);
  process.env.GITHUB_SHA = 'a'.repeat(40);
  t.after(() => delete process.env.GITHUB_SHA);
  let signed = 0;
  const manifest = packPort(root, port, { build: false, signer: (staged) => {
    signed += 1;
    assert.equal(staged.length, 2);
  } });
  assert.equal(signed, 1);
  assert.equal(manifest.packages.length, 2);
  assert.ok(manifest.packages.every((pkg) => pkg.version === '1.2.3-4' && pkg.integrity.startsWith('sha512-')));
  const list = join(root, 'published.txt');
  process.env.PACKAGE_LIST = list;
  t.after(() => delete process.env.PACKAGE_LIST);
  publishPort(port, { dryRun: true });
  const lines = readFileSync(list, 'utf8').trim().split('\n');
  assert.deepEqual(lines, ['@ohos-npm-ports/demo-openharmony-arm64@1.2.3-4', '@ohos-npm-ports/demo@1.2.3-4']);
});

function packedFixture(t) {
  const { root, dir } = fixture(t);
  const port = loadPort(root, dir);
  process.env.GITHUB_SHA = 'a'.repeat(40);
  t.after(() => delete process.env.GITHUB_SHA);
  const manifest = packPort(root, port, { build: false, signer: () => {} });
  const list = join(root, 'published.txt');
  writeFileSync(list, '');
  process.env.PACKAGE_LIST = list;
  t.after(() => delete process.env.PACKAGE_LIST);
  return { port, manifest, published: () => readFileSync(list, 'utf8').trim().split('\n').filter(Boolean) };
}

test('publish sends slot packages first and the main package last', (t) => {
  const { port, manifest, published } = packedFixture(t);
  const file = join(port.dir, 'artifacts', 'manifest.json');
  writeFileSync(file, JSON.stringify({ ...manifest, packages: [...manifest.packages].reverse() }));
  publishPort(port, { dryRun: true });
  assert.deepEqual(published(), ['@ohos-npm-ports/demo-openharmony-arm64@1.2.3-4', '@ohos-npm-ports/demo@1.2.3-4']);
});

test('skip-existing skips identical versions, rejects different content and publishes the rest', (t) => {
  const { port, manifest, published } = packedFixture(t);
  const integrity = Object.fromEntries(manifest.packages.map((pkg) => [pkg.name, pkg.integrity]));
  publishPort(port, { dryRun: true, skipExisting: true, lookup: (name) => integrity[name] });
  assert.deepEqual(published(), []);
  assert.throws(() => publishPort(port, { dryRun: true, skipExisting: true, lookup: () => 'sha512-other' }), /already published with different content/);
  publishPort(port, { dryRun: true, skipExisting: true, lookup: (name) => (name.endsWith('-openharmony-arm64') ? integrity[name] : null) });
  assert.deepEqual(published(), ['@ohos-npm-ports/demo@1.2.3-4']);
  assert.throws(() => publishPort(port, { dryRun: true, skipExisting: true, lookup: () => { throw new Error('registry down'); } }), /registry down/);
});

test('a dist-tag is never moved back to an older version', (t) => {
  assert.equal(chooseTag('latest', '1.2.3-4', null), 'latest');
  assert.equal(chooseTag('latest', '1.2.3-4', '1.2.3-3'), 'latest');
  assert.equal(chooseTag('latest', '1.2.3-4', '1.2.3-10'), 'stale');
  assert.equal(chooseTag('latest', '1.2.3-4', '1.3.0-1'), 'stale');
  const { port, published } = packedFixture(t);
  const logs = [];
  const log = console.log;
  console.log = (line) => logs.push(line);
  t.after(() => { console.log = log; });
  publishPort(port, { dryRun: true, skipExisting: true, lookup: () => null, tagLookup: () => '9.0.0-1' });
  assert.equal(published().length, 2);
  assert.ok(logs.filter((line) => line.startsWith('Would publish')).every((line) => line.endsWith('with tag stale')));
  logs.length = 0;
  publishPort(port, { dryRun: true, skipExisting: true, lookup: () => null, tagLookup: () => null });
  assert.ok(logs.filter((line) => line.startsWith('Would publish')).every((line) => line.endsWith('with tag latest')));
});

test('publish refuses artifacts built from another commit when a commit is expected', (t) => {
  const { port } = packedFixture(t);
  assert.throws(() => publishPort(port, { dryRun: true, expectSha: 'b'.repeat(40) }), /expected b{40}/);
  assert.doesNotThrow(() => publishPort(port, { dryRun: true, expectSha: 'a'.repeat(40) }));
});

test('tarballs fetched from npm for testing are never published', (t) => {
  const { port, manifest } = packedFixture(t);
  writeFileSync(join(port.dir, 'artifacts', 'manifest.json'), JSON.stringify({ ...manifest, origin: 'npm' }));
  assert.throws(() => publishPort(port, { dryRun: true }), /downloaded from npm, only freshly built tarballs can be published/);
  assert.throws(() => publishPort(port, { dryRun: true, skipExisting: true, expectSha: 'a'.repeat(40) }), /downloaded from npm/);
});

test('dist-tag lookups tolerate a missing package or tag but not an outage', () => {
  const ok = (value) => () => JSON.stringify(value);
  const fail = (stdout, stderr = '') => () => { throw Object.assign(new Error('exit 1'), { stdout, stderr }); };
  assert.equal(distTagVersion('@ohos-npm-ports/demo', 'latest', { exec: ok({ latest: '1.0.0-2', next: '2.0.0-1' }) }), '1.0.0-2');
  assert.equal(distTagVersion('@ohos-npm-ports/demo', 'beta', { exec: ok({ latest: '1.0.0-2' }) }), null);
  assert.equal(distTagVersion('@ohos-npm-ports/demo', 'latest', { exec: fail('{"error":{"code":"E404"}}') }), null);
  assert.throws(() => distTagVersion('@ohos-npm-ports/demo', 'latest', { exec: fail('', 'npm error code ECONNRESET') }), /ECONNRESET/);
});

test('registry lookups treat only E404 as an unpublished version', () => {
  const fail = (stdout, stderr = '') => () => { throw Object.assign(new Error('exit 1'), { stdout, stderr }); };
  assert.equal(publishedIntegrity('@ohos-npm-ports/demo', '1.0.0-1', { exec: () => '"sha512-abc"\n' }), 'sha512-abc');
  assert.equal(publishedIntegrity('@ohos-npm-ports/demo', '1.0.0-1', { exec: fail('{"error":{"code":"E404","summary":"No match"}}') }), null);
  assert.equal(publishedIntegrity('@ohos-npm-ports/demo', '1.0.0-1', { exec: fail('', 'npm error code E404') }), null);
  assert.throws(() => publishedIntegrity('@ohos-npm-ports/demo', '1.0.0-1', { exec: fail('', 'npm error code ETIMEDOUT') }), /ETIMEDOUT/);
  assert.throws(() => publishedIntegrity('@ohos-npm-ports/demo', '1.0.0-1', { exec: () => '' }), /no sha512 integrity/);
  assert.throws(() => publishedIntegrity('@ohos-npm-ports/demo', '1.0.0-1', { exec: () => '"sha1-abc"' }), /no sha512 integrity/);
});

test('unbumped ports are changed ports that keep their version, ignoring test.mjs, new and deleted ports', () => {
  const versions = { 'ports/a/same': '1.0.0-1', 'ports/b/bumped': '1.0.0-1', 'ports/c/testonly': '1.0.0-1' };
  const bumped = { ...versions, 'ports/b/bumped': '1.0.0-2' };
  const head = { ...bumped, 'ports/d/new': '1.0.0-1' };
  delete head['ports/e/gone'];
  const base = { ...versions, 'ports/e/gone': '1.0.0-1' };
  const lookup = (table) => (dir) => table[dir] ?? null;
  const changed = ['ports/a/same/patches/x.patch', 'ports/b/bumped/NPMBUILD', 'ports/c/testonly/test.mjs', 'ports/d/new/NPMBUILD', 'ports/e/gone/NPMBUILD', 'cli/build.mjs', 'ports/a/same/NPMBUILD'];
  assert.deepEqual(unbumpedPorts(changed, { baseVersion: lookup(base), headVersion: lookup(head) }), ['ports/a/same']);
});

test('pack signing selects only regular AArch64 ELF files', (t) => {
  const { root, dir } = fixture(t);
  const elf = (machine, littleEndian = true) => {
    const header = Buffer.alloc(20);
    header.set([0x7f, 0x45, 0x4c, 0x46, 1, littleEndian ? 1 : 2]);
    if (littleEndian) header.writeUInt16LE(machine, 18);
    else header.writeUInt16BE(machine, 18);
    return header;
  };
  const mainDir = join(dir, 'build', 'main');
  const slotDir = join(dir, 'slots', 'demo', 'build', 'slot');
  const nested = join(mainDir, 'nested');
  mkdirSync(nested, { recursive: true });
  const arm = join(nested, 'arm.node');
  const bigEndianArm = join(slotDir, 'arm-be.node');
  writeFileSync(arm, elf(183));
  writeFileSync(bigEndianArm, elf(183, false));
  writeFileSync(join(mainDir, 'x64.node'), elf(62));
  writeFileSync(join(mainDir, 'notes.txt'), 'not an ELF');
  symlinkSync(arm, join(mainDir, 'arm-link.node'));
  symlinkSync(nested, join(slotDir, 'linked-directory'));
  const expected = [arm, bigEndianArm].sort();
  assert.deepEqual(findAarch64ElfFiles([mainDir, slotDir]), expected);
  const command = join(root, 'selfsign');
  writeFileSync(command, 'fake selfsign');
  const calls = [];
  const files = signPackages([{ directory: mainDir }, { directory: slotDir }], {
    command,
    execute: (actualCommand, args) => { calls.push([actualCommand, args]); },
  });
  assert.deepEqual(files, expected);
  assert.deepEqual(calls, expected.map((file) => [command, ['--force', file]]));
  assert.throws(() => signPackages([], { command: 'selfsign' }), /absolute path/);
});

test('lint reserves signing and readelf checks for pack', (t) => {
  const { root, dir } = fixture(t);
  const port = loadPort(root, dir);
  const file = join(dir, 'NPMBUILD');
  writeFileSync(file, `${readFileSync(file, 'utf8')}binary-sign-tool sign -selfSign 1\n`);
  assert.throws(() => lintPort(port), /signing and signature checks are managed by npm-ports pack/);
  writeFileSync(file, `${readFileSync(file, 'utf8')}readelf -S binding.node | grep -q '\\.codesign'\n`);
  assert.throws(() => lintPort(port), /readelf checks are not needed in NPMBUILD/);
});

test('lint rejects consecutive blank lines left by edits', (t) => {
  const { root, dir } = fixture(t);
  const port = loadPort(root, dir);
  const file = join(dir, 'NPMBUILD');
  writeFileSync(file, `${readFileSync(file, 'utf8')}\n\n`);
  assert.throws(() => lintPort(port), /collapse consecutive blank lines/);
});

test('bump updates only source and resource declarations', async (t) => {
  const { root, dir } = fixture(t);
  const portFile = join(dir, 'NPMBUILD');
  const declarations = [
    'source="https://registry.npmjs.org/demo/-/demo-${version}.tgz"',
    `sha256="${'a'.repeat(64)}"`,
    'resource "source_archive" \\',
    '  "https://github.com/example/demo/archive/v${version}.tar.gz" \\',
    `  "${'b'.repeat(64)}"`,
    'resource "pinned_tool" \\',
    '  "https://example.com/tool-0.1.0.tar.gz" \\',
    `  "${'c'.repeat(64)}"`,
    '',
  ].join('\n');
  writeFileSync(portFile, readFileSync(portFile, 'utf8')
    .replace('"build/main"', '"build/demo-1.2.3"')
    .replace('build() { :; }', `${declarations}\nbuild() { :; }\n# demo 1.2.3\necho 1.2.3`));
  const patches = join(dir, 'patches');
  const patch = join(patches, '0001-test.patch');
  const patchText = '# cross-port dependency remains 1.2.3-7\n';
  mkdirSync(patches);
  writeFileSync(patch, patchText);
  const port = loadPort(root, dir);
  assert.deepEqual(port.resources.map(({ name }) => name), ['source_archive', 'pinned_tool']);
  const downloads = [];
  const output = join(root, 'github-output');
  const changed = await bumpPorts(root, [port], {
    write: true,
    output,
    metadata: async () => ({ 'dist-tags': { latest: '1.3.0' }, versions: ['1.2.3', '1.3.0'] }),
    download: async (url) => {
      downloads.push(url);
      if (url === 'https://registry.npmjs.org/demo/-/demo-1.3.0.tgz') return 'd'.repeat(64);
      if (url === 'https://github.com/example/demo/archive/v1.3.0.tar.gz') return 'e'.repeat(64);
      throw new Error(`Unexpected download: ${url}`);
    },
  });
  assert.equal(changed.length, 1);
  assert.equal(changed[0].resources.length, 1);
  assert.match(readFileSync(output, 'utf8'), /version=1.3.0/);
  const text = readFileSync(portFile, 'utf8');
  assert.match(text, /version="1.3.0"/);
  assert.match(text, /revision=1/);
  assert.match(text, new RegExp(`sha256="${'d'.repeat(64)}"`));
  assert.match(text, new RegExp(`"${'e'.repeat(64)}"`));
  assert.match(text, new RegExp(`"${'c'.repeat(64)}"`));
  assert.match(text, /demo-\$\{version\}\.tgz/);
  assert.match(text, /archive\/v\$\{version\}\.tar\.gz/);
  assert.doesNotMatch(text, /archive\/v1\.3\.0\.tar\.gz/);
  assert.match(text, /"build\/demo-1\.2\.3"/);
  assert.match(text, /# demo 1\.2\.3\necho 1\.2\.3/);
  assert.deepEqual(downloads.sort(), [
    'https://github.com/example/demo/archive/v1.3.0.tar.gz',
    'https://registry.npmjs.org/demo/-/demo-1.3.0.tgz',
  ]);
  assert.equal(readFileSync(patch, 'utf8'), patchText);
});

test('port assignment updates preserve unrelated fields', () => {
  assert.equal(updatePortText('version="1.0.0"\nrevision=4\ndist_tag="latest"\n', { version: '2.0.0', revision: '1' }), 'version="2.0.0"\nrevision=1\ndist_tag="latest"\n');
});

test('bump-pr creates a versioned branch without force-pushing', async () => {
  const root = '/repo';
  const port = { name: 'demo', version: '1.2.3', relative: 'ports/d/demo' };
  const branch = 'automation/bump-demo-1.3.0';
  const commands = [];
  const execute = (command, args) => {
    const key = `${command} ${args.join(' ')}`;
    commands.push(key);
    if (key === 'git rev-parse --show-toplevel') return root;
    if (key === 'git status --porcelain' || key === `git branch --list ${branch}`) return '';
    if (key === 'git rev-parse HEAD' || key === 'git rev-parse origin/main') return 'a'.repeat(40);
    if (key === 'git diff --cached --name-only') return port.relative;
    if (key === 'git config user.name') return 'hqzing';
    if (key === 'git config user.email') return 'hqzing@outlook.com';
    if (key === 'gh --version' || key === 'gh auth status') return 'ok';
    if (key.startsWith('gh repo view')) return 'hqzing/ohos-npm-ports';
    if (key.includes('pr list') && key.includes('--base main')) return '[]';
    if (key.includes('pr list') && key.includes('.[0].number')) return '1';
    if (key.startsWith('gh pr view')) return 'https://github.com/hqzing/ohos-npm-ports/pull/1';
    return '';
  };
  const result = await bumpPr(root, port, { execute, bump: async (_, ports) => {
    assert.equal(ports.length, 1);
    return [{ version: '1.3.0' }];
  } });
  assert.equal(result.number, '1');
  assert.ok(commands.includes(`git switch -c ${branch}`));
  assert.ok(commands.includes(`git push -u origin HEAD:refs/heads/${branch}`));
  const create = commands.find((command) => command.startsWith('gh pr create'));
  assert.ok(create.endsWith('--draft'));
  assert.match(create, /- demo: 1\.2\.3 → 1\.3\.0\n/);
  assert.equal(commands.some((command) => /force|pr edit|ls-remote/.test(command)), false);
});

test('bump-pr skips duplicate and older open PRs for the same port', async () => {
  const root = '/repo';
  const port = { name: 'demo', version: '1.2.3', relative: 'ports/d/demo' };
  const commands = [];
  const open = [{ number: 7, title: 'demo: bump to 1.2.9', url: 'https://example.test/pull/7', files: [{ path: `${port.relative}/NPMBUILD` }] }];
  const execute = (command, args) => {
    const key = `${command} ${args.join(' ')}`;
    commands.push(key);
    if (key === 'git rev-parse --show-toplevel') return root;
    if (key === 'git status --porcelain') return '';
    if (key === 'git rev-parse HEAD' || key === 'git rev-parse origin/main') return 'a'.repeat(40);
    if (key.startsWith('gh repo view')) return 'hqzing/ohos-npm-ports';
    if (key.includes('pr list') && key.includes('--base main')) return JSON.stringify(open);
    return '';
  };
  const bump = async () => { throw new Error('must not bump'); };
  const result = await bumpPr(root, port, { execute, bump });
  assert.deepEqual(result, { skipped: true, number: '7', url: 'https://example.test/pull/7' });
  open[0].title = 'demo: bump to 1.3.0';
  const duplicate = await bumpPr(root, port, { execute, bump });
  assert.deepEqual(duplicate, result);
  assert.equal(commands.some((command) => /switch|push|pr create|pr edit/.test(command)), false);
});

test('bump-pr does not create branches when the port is current', async () => {
  const commands = [];
  const port = { name: 'demo', version: '1.2.3', relative: 'ports/d/demo' };
  const execute = (command, args) => {
    const key = `${command} ${args.join(' ')}`;
    commands.push(key);
    if (key === 'git rev-parse --show-toplevel') return '/repo';
    if (key === 'git status --porcelain') return '';
    if (key === 'git rev-parse HEAD' || key === 'git rev-parse origin/main') return 'a'.repeat(40);
    if (key.startsWith('gh repo view')) return 'hqzing/ohos-npm-ports';
    if (key.includes('pr list') && key.includes('--base main')) return '[]';
    return '';
  };
  const result = await bumpPr('/repo', port, { execute, bump: async () => [] });
  assert.equal(result, null);
  assert.equal(commands.some((command) => command.includes('switch -c')), false);
});
