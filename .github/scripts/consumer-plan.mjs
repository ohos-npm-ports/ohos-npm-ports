import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverPorts, loadPort } from '../../cli/port.mjs';
import { publishedIntegrity } from '../../cli/registry.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const excluded = JSON.parse(readFileSync(join(repo, '.github/fixtures/consumer/excluded-ports.json'), 'utf8'));
export const infrastructure = JSON.parse(readFileSync(join(repo, '.github/fixtures/consumer/infrastructure.json'), 'utf8'));
export const isInfrastructure = (file) => !file.endsWith('.md')
  && infrastructure.some((entry) => entry.endsWith('/') ? file.startsWith(entry) : file === entry);
const isExcluded = (dir) => Object.hasOwn(excluded, basename(dir));
const ports = new Map();
function port(dir) {
  if (!ports.has(dir)) ports.set(dir, loadPort(repo, dir));
  return ports.get(dir);
}
const portDirPattern = /^ports\/[a-z0-9]\/[^/]+$/;

export function testSpec(portDir) {
  assert.match(portDir, portDirPattern);
  const file = join(repo, portDir, 'test.js');
  if (!existsSync(file)) return null;
  const source = readFileSync(file, 'utf8');
  const field = (name) => source.match(new RegExp(`^// @test-${name}: ([^\\r\\n]+)$`, 'm'))?.[1];
  const upstream = field('package');
  assert.ok(upstream, `Missing @test-package: ${file}`);
  assert.match(upstream, /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/);
  if (field('browser')) assert.equal(field('browser'), 'chromium', `Invalid browser: ${file}`);
  if (field('setup')) assert.ok(['true', 'false'].includes(field('setup')), `Invalid setup flag: ${file}`);
  const format = field('format') ?? 'esm';
  assert.ok(['esm', 'cjs'].includes(format), `Invalid test format: ${file}`);
  const role = field('role') ?? 'primary';
  assert.ok(['primary', 'support'].includes(role), `Invalid test role: ${file}`);
  const timeout = Number(field('timeout') ?? 600);
  assert.ok(Number.isInteger(timeout) && timeout > 0 && timeout <= 1800, `Invalid test timeout: ${file}`);
  const project = field('project') ?? 'node';
  assert.match(project, /^[a-z0-9-]+$/);
  const localFixture = field('fixture');
  if (localFixture) assert.match(localFixture, /^(?:[a-z0-9_-]+\/)*[a-z0-9_-]+$/);
  const fixture = localFixture ? join(repo, portDir, localFixture) : join(repo, '.github/fixtures/consumer/projects', project);
  assert.ok(existsSync(join(fixture, 'package.json')), `Missing consumer fixture: ${fixture}`);
  const prerequisites = [...source.matchAll(/^\/\/ @test-prerequisite: (ports\/[a-z0-9]\/[^/\r\n]+)$/gm)].map((match) => match[1]);
  const platforms = (field('platforms') ?? 'win32,linux,darwin,openharmony').split(',');
  if (platforms.length < 4) assert.ok(field('platform-reason'), `Explain the restricted test platforms: ${file}`);
  return {
    portDir, file, upstream, version: field('upstream-version') ?? port(portDir).version,
    portVersion: port(portDir).portVersion,
    portPackage: field('port-package') ?? `@ohos-npm-ports/${port(portDir).pkgname}`,
    setup: field('setup') === 'true', format, role, timeout, browser: field('browser'), project, fixture, prerequisites, platforms, reason: field('platform-reason'),
  };
}

export function closure(dirs) {
  const visited = new Set();
  const ordered = [];
  function visit(dir) {
    assert.match(dir, portDirPattern);
    assert.ok(!isExcluded(dir), `Required port is excluded: ${dir}`);
    if (visited.has(dir)) return;
    assert.ok(existsSync(join(repo, dir, 'NPMBUILD')), `Missing NPMBUILD: ${dir}`);
    visited.add(dir);
    for (const prerequisite of testSpec(dir)?.prerequisites ?? []) visit(prerequisite);
    ordered.push(dir);
  }
  dirs.forEach(visit);
  return ordered;
}

function allPortDirs() {
  return discoverPorts(repo).map((dir) => relative(repo, dir).split('/').join('/'));
}

function allTests() {
  return allPortDirs().filter((dir) => !isExcluded(dir) && existsSync(join(repo, dir, 'test.js')) && testSpec(dir).role === 'primary');
}

export function artifactPattern(port) {
  const names = closure([port]).map((dir) => `port-${basename(dir)}`);
  return names.length === 1 ? names[0] : `{${names.join(',')}}`;
}

// A port needs publishing when its main package version is absent from npm. Judging by the registry instead of
// by the diff makes publishing self-healing: a version whose earlier run failed is picked up by the next push,
// and edits that leave the version alone (CI, test.js, mass renames) never try to publish over it.
// PUBLISHED_PACKAGES (a JSON array of "name@version") replaces the registry lookup in tests.
export function missingFromRegistry(dirs, { published = process.env.PUBLISHED_PACKAGES, lookup = publishedIntegrity } = {}) {
  const known = published ? new Set(JSON.parse(published)) : null;
  return dirs.filter((dir) => {
    const { pkgname, portVersion } = port(dir);
    const name = `@ohos-npm-ports/${pkgname}`;
    return known ? !known.has(`${name}@${portVersion}`) : lookup(name, portVersion) === null;
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2] === 'artifact-pattern') {
  console.log(artifactPattern(process.argv[3]));
} else if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const changed = readFileSync(0, 'utf8').trim().split('\n').filter(Boolean);
  const dirs = [...new Set(changed.filter((file) => file.startsWith('ports/')).map((file) => file.split('/').slice(0, 3).join('/')))]
    .filter((dir) => existsSync(join(repo, dir, 'NPMBUILD')) && !isExcluded(dir));
  if (process.env.BUILD_ALL === 'true') dirs.push(...allPortDirs());
  for (const [port, reason] of Object.entries(excluded)) console.error(`::notice::Excluded port ${port}: ${reason}`);
  const infrastructureChanged = changed.some(isInfrastructure);
  const candidates = allTests();
  const selected = infrastructureChanged ? allPortDirs() : candidates.filter((dir) => closure([dir]).some((input) => dirs.includes(input)));
  if (process.env.CONSUMER_SELECTION) {
    const requested = JSON.parse(process.env.CONSUMER_SELECTION);
    assert.ok(Array.isArray(requested) && requested.length > 0, 'Consumer selection must be a nonempty JSON array');
    assert.equal(new Set(requested).size, requested.length, 'Duplicate consumer selection');
    for (const dir of requested) assert.ok(candidates.includes(dir), `Unknown/non-primary consumer: ${dir}`);
    selected.splice(0, selected.length, ...requested);
  }
  const expanded = closure(selected);
  const tests = selected.filter((dir) => testSpec(dir)?.role === 'primary');
  const matrix = [...new Set([...dirs, ...expanded])].sort();
  console.log(`matrix=${JSON.stringify(matrix)}`);
  const publish = process.env.PUBLISH_CHECK === 'true' ? missingFromRegistry(matrix) : [];
  console.log(`publish=${JSON.stringify(publish)}`);
  // Prerequisites first, so a port is never on npm before the ports its install depends on.
  const publishing = new Set(publish);
  console.log(`publish-order=${JSON.stringify(closure(publish).filter((dir) => publishing.has(dir)))}`);
  console.log(`generic-enabled=${matrix.length > 0 || Boolean(process.env.ARTIFACT_RUN_ID)}`);
  console.log(`generic-ports=${JSON.stringify(matrix)}`);
  console.log(`consumer-enabled=${tests.length > 0}`);
  console.log(`consumer-ports=${JSON.stringify(tests)}`);
}
