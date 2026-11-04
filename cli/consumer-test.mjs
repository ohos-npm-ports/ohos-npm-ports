import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { defaultRoot, loadPort } from './port.mjs';

const portDirPattern = /^ports\/[a-z0-9]\/[^/]+$/;
const contexts = new Map();

function context(root) {
  const directory = resolve(root);
  if (!contexts.has(directory)) {
    const excluded = JSON.parse(readFileSync(join(directory, '.github/fixtures/consumer/excluded-ports.json'), 'utf8'));
    contexts.set(directory, { excluded, ports: new Map() });
  }
  return contexts.get(directory);
}

function recipe(context, root, portDir) {
  if (!context.ports.has(portDir)) context.ports.set(portDir, loadPort(root, join(root, portDir)));
  return context.ports.get(portDir);
}

export function testSpec(portDir, root = defaultRoot) {
  assert.match(portDir, portDirPattern);
  const repo = resolve(root);
  const file = join(repo, portDir, 'test.mjs');
  if (!existsSync(file)) return null;
  const state = context(repo);
  const source = readFileSync(file, 'utf8');
  const field = (name) => source.match(new RegExp(`^// @test-${name}: ([^\\r\\n]+)$`, 'm'))?.[1];
  const upstream = field('package') ?? recipe(state, repo, portDir).upstream;
  assert.match(upstream, /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/);
  if (field('browser')) assert.equal(field('browser'), 'chromium', `Invalid browser: ${file}`);
  if (field('setup')) assert.ok(['true', 'false'].includes(field('setup')), `Invalid setup flag: ${file}`);
  const role = field('role') ?? 'primary';
  assert.ok(['primary', 'support'].includes(role), `Invalid test role: ${file}`);
  const timeout = Number(field('timeout') ?? 600);
  assert.ok(Number.isInteger(timeout) && timeout > 0 && timeout <= 1800, `Invalid test timeout: ${file}`);
  const project = field('project') ?? 'node';
  assert.match(project, /^[a-z0-9-]+$/);
  const localFixture = field('fixture');
  if (localFixture) assert.match(localFixture, /^(?:[a-z0-9_-]+\/)*[a-z0-9_-]+$/);
  const fixture = localFixture ? join(repo, portDir, localFixture) : '';
  if (fixture) assert.ok(existsSync(join(fixture, 'package.json')), `Missing consumer fixture: ${fixture}`);
  const prerequisites = [...source.matchAll(/^\/\/ @test-prerequisite: (ports\/[a-z0-9]\/[^/\r\n]+)$/gm)].map((match) => match[1]);
  const platforms = (field('platforms') ?? 'win32,linux,darwin,openharmony').split(',');
  if (platforms.length < 4) assert.ok(field('platform-reason'), `Explain the restricted test platforms: ${file}`);
  return {
    portDir, file, upstream, version: field('upstream-version') ?? recipe(state, repo, portDir).version,
    revision: recipe(state, repo, portDir).revision,
    portVersion: recipe(state, repo, portDir).portVersion,
    portPackage: field('port-package') ?? `@ohos-npm-ports/${recipe(state, repo, portDir).pkgname}`,
    setup: field('setup') === 'true', role, timeout, browser: field('browser'), project, fixture, prerequisites, platforms, reason: field('platform-reason'),
  };
}

export function closure(dirs, root = defaultRoot) {
  const repo = resolve(root);
  const state = context(repo);
  const visited = new Set();
  const ordered = [];
  function visit(dir) {
    assert.match(dir, portDirPattern);
    assert.ok(!Object.hasOwn(state.excluded, basename(dir)), `Required port is excluded: ${dir}`);
    if (visited.has(dir)) return;
    assert.ok(existsSync(join(repo, dir, 'NPMBUILD')), `Missing NPMBUILD: ${dir}`);
    visited.add(dir);
    for (const prerequisite of testSpec(dir, repo)?.prerequisites ?? []) visit(prerequisite);
    ordered.push(dir);
  }
  dirs.forEach(visit);
  return ordered;
}
