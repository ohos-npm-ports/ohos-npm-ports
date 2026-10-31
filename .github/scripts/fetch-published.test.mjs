import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fetchPort, slotNames } from './fetch-published.mjs';

const sha = 'a'.repeat(40);
const main = '@ohos-npm-ports/demo';
const slot = '@ohos-npm-ports/demo-openharmony-arm64';
const integrityOf = (content) => `sha512-${createHash('sha512').update(content).digest('base64')}`;

// A port with a main package and one slot, the same shape build.mjs produces.
function fixture(t, packages = '("slot" "main")') {
  const root = mkdtempSync(join(tmpdir(), 'fetch-published-'));
  const dir = join(root, 'ports', 'd', 'demo');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'NPMBUILD'), `pkgname="demo"\nupstream="demo"\nversion="1.2.3"\nrevision=4\ndist_tag="latest"\npackages=${packages}\nbuild() { :; }\n`);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

// A fake registry: what `npm view` and `npm pack` would answer for the demo port.
function registry({ withSlot = true, corrupt = false, flaky = 0 } = {}) {
  const tarballs = { [main]: `main tarball`, [slot]: `slot tarball` };
  const documents = {
    [main]: { name: main, version: '1.2.3-4', dist: { integrity: integrityOf(tarballs[main]) }, optionalDependencies: withSlot ? { '@demo/slot': `npm:${slot}@1.2.3-4` } : {} },
    [slot]: { name: slot, version: '1.2.3-4', dist: { integrity: integrityOf(tarballs[slot]) } },
  };
  const calls = [];
  let failures = flaky;
  return {
    calls,
    metadataOf: (name, version) => {
      calls.push(`view ${name}@${version}`);
      if (failures > 0) { failures -= 1; throw new Error('ECONNRESET'); }
      return documents[name] ?? null;
    },
    pack: (spec, destination) => {
      calls.push(`pack ${spec}`);
      const name = spec.slice(0, spec.lastIndexOf('@'));
      const filename = `${name.replace(/^@/, '').replace('/', '-')}-1.2.3-4.tgz`;
      writeFileSync(join(destination, filename), corrupt ? 'tampered' : tarballs[name]);
      return filename;
    },
  };
}
const options = (fake, extra = {}) => ({ sourceSha: sha, metadataOf: fake.metadataOf, pack: fake.pack, sleep: () => {}, ...extra });

test('slot packages are the main package references that carry the port version', () => {
  const metadata = {
    dependencies: { '@scope/plain': '1.2.3-4', other: '^1.0.0', '@ohos-npm-ports/elsewhere': '9.9.9-1', '@upstream/a': 'npm:@ohos-npm-ports/demo-linux@1.2.3-4' },
    optionalDependencies: { '@upstream/b': `npm:${slot}@1.2.3-4`, '@upstream/c': 'npm:@other/not-ours@1.2.3-4', '@ohos-npm-ports/demo-win': '1.2.3-4', [main]: '1.2.3-4' },
  };
  assert.deepEqual(slotNames(metadata, main, '1.2.3-4'), ['@ohos-npm-ports/demo-linux', slot, '@ohos-npm-ports/demo-win']);
  assert.deepEqual(slotNames({}, main, '1.2.3-4'), []);
});

test('published tarballs become an artifact directory with the manifest the consumers read', (t) => {
  const root = fixture(t);
  const fake = registry();
  const manifest = fetchPort(root, 'ports/d/demo', options(fake));
  assert.deepEqual(manifest, {
    sourceSha: sha,
    origin: 'npm',
    portDir: 'ports/d/demo',
    packages: [
      { name: main, version: '1.2.3-4', filename: 'ohos-npm-ports-demo-1.2.3-4.tgz', integrity: integrityOf('main tarball') },
      { name: slot, version: '1.2.3-4', filename: 'ohos-npm-ports-demo-openharmony-arm64-1.2.3-4.tgz', integrity: integrityOf('slot tarball') },
    ],
  });
  const artifacts = join(root, 'ports/d/demo/artifacts');
  assert.deepEqual(JSON.parse(readFileSync(join(artifacts, 'manifest.json'), 'utf8')), manifest);
  for (const pkg of manifest.packages) assert.equal(integrityOf(readFileSync(join(artifacts, pkg.filename))), pkg.integrity);
  assert.ok(fake.calls.includes(`pack ${slot}@1.2.3-4`));
});

test('a version that is not on npm cannot be fetched', (t) => {
  const root = fixture(t);
  const fake = registry();
  assert.throws(() => fetchPort(root, 'ports/d/demo', options({ ...fake, metadataOf: () => null })), /@ohos-npm-ports\/demo@1\.2\.3-4 is not published on npm/);
});

test('fetching fails instead of testing an incomplete set of packages', (t) => {
  const root = fixture(t);
  assert.throws(() => fetchPort(root, 'ports/d/demo', options(registry({ withSlot: false }))), /found 1 published package\(s\).*NPMBUILD builds 2/);
  const single = fixture(t, '("main")');
  assert.equal(fetchPort(single, 'ports/d/demo', options(registry({ withSlot: false }))).packages.length, 1);
});

test('a tarball that differs from the registry integrity is rejected', (t) => {
  const root = fixture(t);
  assert.throws(() => fetchPort(root, 'ports/d/demo', options(registry({ corrupt: true }))), /downloaded tarball differs from the registry integrity/);
});

test('transient registry failures are retried, persistent ones fail', (t) => {
  const root = fixture(t);
  const fake = registry({ flaky: 2 });
  assert.equal(fetchPort(root, 'ports/d/demo', options(fake)).packages.length, 2);
  assert.throws(() => fetchPort(root, 'ports/d/demo', options(registry({ flaky: 9 }))), /ECONNRESET/);
});

test('unsafe tarball names and unknown commits are refused', (t) => {
  const root = fixture(t);
  const fake = registry();
  assert.throws(() => fetchPort(root, 'ports/d/demo', options({ ...fake, pack: () => '../escape.tgz' })), /Unsafe tarball name/);
  assert.throws(() => fetchPort(root, 'ports/d/demo', options(fake, { sourceSha: 'HEAD' })), /sourceSha must be the commit being tested/);
  assert.ok(!existsSync(join(root, 'ports/d/escape.tgz')));
});

test('a rerun replaces what an earlier fetch left in the artifact directory', (t) => {
  const root = fixture(t);
  const artifacts = join(root, 'ports/d/demo/artifacts');
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(join(artifacts, 'stale.tgz'), 'old');
  fetchPort(root, 'ports/d/demo', options(registry()));
  assert.ok(!existsSync(join(artifacts, 'stale.tgz')));
});
