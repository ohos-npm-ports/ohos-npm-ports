import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { test } from 'node:test';
import { closure, infrastructure, isInfrastructure, missingFromRegistry, testSpec, artifactPattern } from './consumer-plan.mjs';
import { discoverPorts, loadPort } from '../../cli/port.mjs';

const directories = discoverPorts(process.cwd()).map((dir) => relative(process.cwd(), dir));
const plan = (file, env = {}) => Object.fromEntries(execFileSync(process.execPath, ['.github/scripts/consumer-plan.mjs'], { input: `${file}\n`, env: { ...process.env, ...env }, encoding: 'utf8' }).trim().split('\n').map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));

// Registry state for the publish check: every port is published except the ones named.
const published = (...unpublished) => JSON.stringify(directories
  .filter((dir) => !unpublished.includes(dir))
  .map((dir) => { const { pkgname, portVersion } = loadPort(process.cwd(), dir); return `@ohos-npm-ports/${pkgname}@${portVersion}`; }));
const publishing = (file, ...unpublished) => JSON.parse(plan(file, { PUBLISH_CHECK: 'true', PUBLISHED_PACKAGES: published(...unpublished) }).publish);

test('infrastructure selects all ports for generic install and primaries for functional tests', () => {
  const value = plan('.github/fixtures/consumer/test-tools.mjs');
  const primaries = directories.filter((dir) => testSpec(dir)?.role === 'primary');
  assert.deepEqual(new Set(JSON.parse(value.matrix)), new Set(directories));
  assert.deepEqual(new Set(JSON.parse(value['generic-ports'])), new Set(directories));
  assert.equal(value['generic-enabled'], 'true');
  assert.deepEqual(new Set(JSON.parse(value['consumer-ports'])), new Set(primaries));
  assert.ok(JSON.parse(value['consumer-ports']).includes('ports/l/lightningcss@1.32'));
});

test('manual full builds select every port, including ports without consumers', () => {
  const value = plan('.github/scripts/run-port-consumer.mjs', { BUILD_ALL: 'true' });
  assert.deepEqual(new Set(JSON.parse(value.matrix)), new Set(directories));
  assert.ok(JSON.parse(value.matrix).includes('ports/p/parcel-watcher'));
  assert.deepEqual(JSON.parse(value.publish), []);
});

test('artifact replay enables generic install even without a build matrix', () => {
  const value = plan('.github/scripts/run-port-consumer.mjs', { BUILD_ALL: 'true', ARTIFACT_RUN_ID: '12345' });
  assert.equal(value['generic-enabled'], 'true');
  assert.deepEqual(new Set(JSON.parse(value['generic-ports'])), new Set(directories));
});

test('merged slots build and upload with their parent port', () => {
  const value = plan('ports/p/parcel-watcher/NPMBUILD');
  assert.deepEqual(JSON.parse(value.matrix), ['ports/p/parcel-watcher']);
  assert.equal(value['consumer-enabled'], 'false');
  assert.equal(value['generic-enabled'], 'true');
  assert.deepEqual(JSON.parse(value['generic-ports']), ['ports/p/parcel-watcher']);
  assert.equal(loadPort(process.cwd(), 'ports/p/parcel-watcher').packages.length, 2);
  assert.equal(artifactPattern('ports/u/utoo-pack'), '{port-domparser-rs,port-utoo-pack}');
});

test('dependency closure includes every required artifact', () => {
  assert.deepEqual(new Set(closure(['ports/u/utoo-pack'])), new Set(['ports/u/utoo-pack', 'ports/d/domparser-rs']));
});

test('port metadata supplies versions and consumer test options', () => {
  assert.equal(testSpec('ports/n/nw').setup, true);
  assert.equal(testSpec('ports/v/vite-plus').format, 'cjs');
  assert.equal(testSpec('ports/l/lightningcss@1.32').timeout, 600);
  assert.equal(testSpec('ports/l/lightningcss@1.32').project, 'node');
  assert.equal(testSpec('ports/l/lightningcss@1.32').version, '1.32.0');
  assert.equal(testSpec('ports/l/lightningcss@1.32').portVersion, loadPort(process.cwd(), 'ports/l/lightningcss@1.32').portVersion);
  assert.equal(testSpec('ports/l/lightningcss@1.32').portPackage, '@ohos-npm-ports/lightningcss');
  assert.equal(loadPort(process.cwd(), 'ports/l/lightningcss@1.32').versionLine, '1.32');
});

test('debug selection is explicit and rejects non-primary roots', () => {
  const env = { ...process.env, CONSUMER_SELECTION: JSON.stringify(['ports/l/lightningcss@1.32']) };
  const value = execFileSync(process.execPath, ['.github/scripts/consumer-plan.mjs'], { input: '.github/scripts/consumer-plan.mjs\n', env, encoding: 'utf8' });
  assert.ok(value.includes('consumer-ports=["ports/l/lightningcss@1.32"]'));
  assert.throws(() => execFileSync(process.execPath, ['.github/scripts/consumer-plan.mjs'], { input: '', env: { ...env, CONSUMER_SELECTION: '["ports/p/parcel-watcher"]' }, stdio: ['pipe', 'pipe', 'pipe'] }));
});

test('every declared test parses in its selected module format', () => {
  for (const dir of directories) {
    const spec = testSpec(dir);
    if (!spec) continue;
    execFileSync(process.execPath, ['--input-type', spec.format === 'esm' ? 'module' : 'commonjs', '--check'], { input: readFileSync(spec.file), stdio: ['pipe', 'pipe', 'pipe'] });
  }
});

test('workflow path filters match the infrastructure list', () => {
  const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
  const blocks = [
    workflow.slice(workflow.indexOf('  push:'), workflow.indexOf('  pull_request:')),
    workflow.slice(workflow.indexOf('  pull_request:'), workflow.indexOf('\npermissions:')),
  ];
  for (const block of blocks) {
    const paths = [...block.matchAll(/^      - "(.+)"$/gm)].map((match) => match[1]).filter((path) => path !== 'ports/**');
    const expected = infrastructure.map((entry) => entry.endsWith('/') ? `${entry}**` : entry);
    assert.deepEqual(new Set(paths), new Set(expected));
  }
  for (const entry of infrastructure) assert.ok(entry.endsWith('/') || existsSync(entry), `Missing infrastructure file: ${entry}`);
});

test('documentation edits never select the full matrix', () => {
  assert.equal(isInfrastructure('.github/fixtures/consumer/README.md'), false);
  assert.equal(isInfrastructure('.github/scripts/tool-versions.json'), true);
  assert.equal(isInfrastructure('.github/scripts/ci-time-service-compat.sh'), true);
  assert.equal(plan('.github/fixtures/consumer/README.md')['consumer-enabled'], 'false');
});

test('every OS has its own consumer job below the matrix limit', () => {
  const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
  assert.doesNotMatch(workflow, /^\s+target:$/m);
  for (const target of ['win32-x64', 'linux-arm64', 'linux-x64', 'darwin-arm64', 'openharmony-arm64']) assert.ok(workflow.includes(`, ${target})`), target);
});

test('publish list holds only versions missing from npm, never other ports in the matrix', () => {
  assert.deepEqual(publishing('ports/l/lightningcss@1.32/NPMBUILD', 'ports/l/lightningcss@1.32'), ['ports/l/lightningcss@1.32']);
  assert.deepEqual(publishing('ports/l/lightningcss@1.32/NPMBUILD'), []);
  assert.deepEqual(publishing('.github/scripts/run-port-consumer.mjs'), []);
  assert.deepEqual(publishing('.github/fixtures/consumer/README.md'), []);
});

test('infrastructure edits publish only the versions npm is missing', () => {
  assert.deepEqual(publishing('.github/workflows/ci.yml'), []);
  assert.deepEqual(publishing('.github/workflows/ci.yml', 'ports/d/domparser-rs', 'ports/v/vite-plus').sort(), ['ports/d/domparser-rs', 'ports/v/vite-plus']);
});

test('a version missing from npm is published even when a later push only touches test.js', () => {
  assert.deepEqual(publishing('ports/v/vite-plus/test.js', 'ports/v/vite-plus'), ['ports/v/vite-plus']);
});

test('nothing is published unless the publish check is requested', () => {
  const value = plan('ports/l/lightningcss@1.32/NPMBUILD', { PUBLISHED_PACKAGES: '[]' });
  assert.deepEqual(JSON.parse(value.publish), []);
  assert.deepEqual(JSON.parse(plan('ports/l/lightningcss@1.32/NPMBUILD', { PUBLISH_CHECK: 'false', PUBLISHED_PACKAGES: '[]' }).publish), []);
});

test('registry lookups distinguish a missing version from a published one', () => {
  const lookups = [];
  const lookup = (name, version) => { lookups.push(`${name}@${version}`); return name.endsWith('/domparser-rs') ? null : 'sha512-x'; };
  assert.deepEqual(missingFromRegistry(['ports/d/domparser-rs', 'ports/u/utoo-pack'], { published: '', lookup }), ['ports/d/domparser-rs']);
  assert.equal(lookups.length, 2);
  assert.throws(() => missingFromRegistry(['ports/d/domparser-rs'], { published: '', lookup: () => { throw new Error('registry down'); } }), /registry down/);
});

test('changing a prerequisite builds its dependents but does not publish them', () => {
  const value = plan('ports/d/domparser-rs/NPMBUILD');
  assert.ok(JSON.parse(value.matrix).includes('ports/u/utoo-pack'));
  assert.deepEqual(publishing('ports/d/domparser-rs/NPMBUILD', 'ports/d/domparser-rs'), ['ports/d/domparser-rs']);
});

test('publish step is limited to the changed ports', () => {
  const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
  const start = workflow.indexOf('      - name: Publish');
  assert.match(workflow.slice(start, workflow.indexOf('\n      - ', start + 1) > 0 ? workflow.indexOf('\n      - ', start + 1) : undefined), /contains\(fromJson\(needs\.detect-changes\.outputs\.publish\), matrix\.dir\)/);
});

test('runner setup, including the time service compatibility library, is used only by consumer jobs', () => {
  const source = readFileSync('.github/workflows/ci.yml', 'utf8');
  const workflow = source.slice(source.indexOf('\njobs:'));
  const users = [...workflow.matchAll(/setup-ci-runner\.sh/g)].map((match) => match.index);
  const jobStarts = [...workflow.matchAll(/^  ([a-z-]+):\n/gm)].map((match) => [match.index, match[1]]);
  assert.ok(users.length > 0);
  for (const position of users) {
    const job = jobStarts.filter(([index]) => index <= position).at(-1)[1];
    assert.match(job, /^consumer-tests/, `setup-ci-runner.sh used by ${job}`);
  }
  assert.match(readFileSync('.github/scripts/setup-ci-runner.sh', 'utf8'), /ci-time-service-compat\.sh/);
});

test('test-only edits run consumers without republishing the port', () => {
  const value = plan('ports/v/vite-plus/test.js');
  assert.equal(value['consumer-enabled'], 'true');
  assert.ok(JSON.parse(value['consumer-ports']).includes('ports/v/vite-plus'));
  assert.ok(JSON.parse(value.matrix).includes('ports/v/vite-plus'));
  assert.deepEqual(publishing('ports/v/vite-plus/test.js'), []);
});

test('test and build edits publish the changed port once, and only while its version is missing', () => {
  assert.deepEqual(publishing('ports/v/vite-plus/test.js\nports/v/vite-plus/NPMBUILD', 'ports/v/vite-plus'), ['ports/v/vite-plus']);
  assert.deepEqual(publishing('ports/v/vite-plus/test.js\nports/v/vite-plus/NPMBUILD'), []);
});
