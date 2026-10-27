import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const excluded = JSON.parse(readFileSync(join(repo, '.github/fixtures/consumer/excluded-ports.json'), 'utf8'));
export const infrastructure = JSON.parse(readFileSync(join(repo, '.github/fixtures/consumer/infrastructure.json'), 'utf8'));
// Documentation edits inside infrastructure directories must not trigger the full matrix.
export const isInfrastructure = (file) => !file.endsWith('.md')
  && infrastructure.some((entry) => entry.endsWith('/') ? file.startsWith(entry) : file === entry);
const isExcluded = (dir) => Object.hasOwn(excluded, dir.split('/')[1]);
export function testSpec(portDir) {
  assert.match(portDir, /^ports\/[^/]+\/[^/]+$/);
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
  const prerequisites = [...source.matchAll(/^\/\/ @test-prerequisite: (ports\/[^/\r\n]+\/[^/\r\n]+)$/gm)].map((match) => match[1]);
  const platforms = (field('platforms') ?? 'win32,linux,darwin,openharmony').split(',');
  if (platforms.length < 4) assert.ok(field('platform-reason'), `Explain the restricted test platforms: ${file}`);
  return {
    portDir, file, upstream, version: field('upstream-version') ?? basename(portDir),
    portPackage: field('port-package') ?? `@ohos-npm-ports/${basename(dirname(portDir))}`,
    setup: field('setup') === 'true', format, role, timeout, browser: field('browser'), project, fixture, prerequisites, platforms, reason: field('platform-reason'),
  };
}

export function closure(dirs) {
  const visited = new Set();
  const ordered = [];
  function visit(dir) {
    assert.match(dir, /^ports\/[^/]+\/[^/]+$/);
    assert.ok(!isExcluded(dir), `Required port is excluded: ${dir}`);
    if (visited.has(dir)) return;
    assert.ok(existsSync(join(repo, dir, 'build.sh')), `Missing build: ${dir}`);
    visited.add(dir);
    for (const prerequisite of testSpec(dir)?.prerequisites ?? []) visit(prerequisite);
    ordered.push(dir);
  }
  dirs.forEach(visit);
  return ordered;
}

function allTests() {
  const tests = [];
  for (const port of readdirSync(join(repo, 'ports'))) {
    for (const version of readdirSync(join(repo, 'ports', port))) {
      const dir = `ports/${port}/${version}`;
      if (!isExcluded(dir) && existsSync(join(repo, dir, 'test.js')) && testSpec(dir).role === 'primary') tests.push(dir);
    }
  }
  return tests;
}

// Artifact download glob for one primary's closure. Each consumer job fetches only
// these, so the API calls per job stay constant instead of growing with the port count.
export function artifactPattern(port) {
  const names = closure([port]).map((dir) => `port-${dir.split('/')[1]}-${dir.split('/')[2]}`);
  return names.length === 1 ? names[0] : `{${names.join(',')}}`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2] === 'artifact-pattern') {
  console.log(artifactPattern(process.argv[3]));
} else if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const changed = readFileSync(0, 'utf8').trim().split('\n').filter(Boolean);
  const dirs = [...new Set(changed.filter((file) => file.startsWith('ports/')).map((file) => file.split('/').slice(0, 3).join('/')))].filter((dir) => !isExcluded(dir));
  for (const [port, reason] of Object.entries(excluded)) console.error(`::notice::Excluded port ${port}: ${reason}`);
  const infrastructureChanged = changed.some(isInfrastructure);
  const candidates = allTests();
  const selected = infrastructureChanged ? candidates : candidates.filter((dir) => closure([dir]).some((input) => dirs.includes(input)));
  if (process.env.CONSUMER_SELECTION) {
    const requested = JSON.parse(process.env.CONSUMER_SELECTION);
    assert.ok(Array.isArray(requested) && requested.length > 0, 'Consumer selection must be a nonempty JSON array');
    assert.equal(new Set(requested).size, requested.length, 'Duplicate consumer selection');
    for (const dir of requested) assert.ok(candidates.includes(dir), `Unknown/non-primary consumer: ${dir}`);
    selected.splice(0, selected.length, ...requested);
  }
  const expanded = closure(selected);
  const tests = selected.filter((dir) => testSpec(dir)?.role === 'primary');
  console.log(`matrix=${JSON.stringify([...new Set([...dirs, ...expanded])].sort())}`);
  // Consumer-only edits do not change the published package.
  const publish = dirs.filter((dir) => changed.some((file) => file.startsWith(`${dir}/`) && file !== `${dir}/test.js`));
  console.log(`publish=${JSON.stringify(publish.sort())}`);
  console.log(`consumer-enabled=${tests.length > 0}`);
  console.log(`consumer-ports=${JSON.stringify(tests)}`);
}
