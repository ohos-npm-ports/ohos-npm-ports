// Usage: node fetch-published.mjs <port dir>...   (run from the repository root)
// Downloads the published tarballs of a port from npm and writes artifacts/manifest.json in the format the
// consumer jobs read, so a port whose build inputs did not change is tested without being rebuilt.
// The manifest says origin "npm": publishPort refuses it, only freshly built tarballs are ever published.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPort } from '../../cli/port.mjs';
import { packageMetadata } from '../../cli/registry.mjs';

const scope = '@ohos-npm-ports/';
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// Slot packages are not listed anywhere but in the built output, so read them back from the published main
// package: build.mjs rewrites every reference to a sibling package to this exact version, either as a plain
// dependency or as an npm: alias.
export function slotNames(metadata, main, version) {
  const names = new Set();
  for (const field of ['dependencies', 'optionalDependencies']) {
    for (const [name, range] of Object.entries(metadata[field] ?? {})) {
      let target = name;
      let resolved = range;
      if (typeof range === 'string' && range.startsWith('npm:')) {
        const alias = range.slice(4);
        const separator = alias.lastIndexOf('@');
        target = alias.slice(0, separator);
        resolved = alias.slice(separator + 1);
      }
      if (target.startsWith(scope) && target !== main && resolved === version) names.add(target);
    }
  }
  return [...names].sort();
}

const defaultSleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const retry = (action, attempts, sleep) => {
  for (let attempt = 1; ; attempt++) {
    try { return action(); } catch (error) {
      if (attempt >= attempts) throw error;
      sleep(attempt * 3000);
    }
  }
};

function defaultPack(spec, destination) {
  const output = execFileSync(npmCommand, ['pack', spec, '--pack-destination', destination, '--json', '--ignore-scripts'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 10 * 1024 * 1024,
  });
  const result = JSON.parse(output);
  assert.ok(Array.isArray(result) && result.length === 1, `Unexpected npm pack result for ${spec}`);
  return result[0].filename;
}

export function fetchPort(root, dir, { sourceSha, metadataOf = packageMetadata, pack = defaultPack, attempts = 3, sleep = defaultSleep } = {}) {
  assert.match(sourceSha, /^[a-f0-9]{40}$/, 'sourceSha must be the commit being tested');
  const port = loadPort(root, join(root, dir));
  const main = `${scope}${port.pkgname}`;
  const version = port.portVersion;
  const lookup = (name) => {
    const metadata = retry(() => metadataOf(name, version), attempts, sleep);
    assert.ok(metadata, `${name}@${version} is not published on npm`);
    return metadata;
  };
  const mainMetadata = lookup(main);
  const names = [main, ...slotNames(mainMetadata, main, version)];
  // The published main package must account for every package the port builds, otherwise the consumers would
  // silently test an incomplete set.
  assert.equal(names.length, port.packages.length, `${dir}: found ${names.length} published package(s) [${names.join(', ')}], NPMBUILD builds ${port.packages.length}`);

  const artifacts = join(root, dir, 'artifacts');
  rmSync(artifacts, { recursive: true, force: true });
  mkdirSync(artifacts, { recursive: true });
  const packages = names.map((name) => {
    const metadata = name === main ? mainMetadata : lookup(name);
    const filename = retry(() => pack(`${name}@${version}`, artifacts), attempts, sleep);
    assert.equal(filename, basename(filename), `Unsafe tarball name for ${name}`);
    const integrity = `sha512-${createHash('sha512').update(readFileSync(join(artifacts, filename))).digest('base64')}`;
    assert.equal(integrity, metadata.dist?.integrity, `${name}@${version}: downloaded tarball differs from the registry integrity`);
    return { name, version, filename, integrity };
  });
  const manifest = { sourceSha, origin: 'npm', portDir: dir, packages };
  writeFileSync(join(artifacts, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const sourceSha = process.env.GITHUB_SHA ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const dirs = process.argv.slice(2);
  assert.ok(dirs.length > 0, 'Usage: fetch-published.mjs <port dir>...');
  for (const dir of dirs) {
    assert.match(dir, /^ports\/[a-z0-9]\/[^/]+$/);
    const manifest = fetchPort(root, dir, { sourceSha });
    console.log(`Fetched ${dir}: ${manifest.packages.map((pkg) => `${pkg.name}@${pkg.version}`).join(', ')}`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `artifact-name=port-${basename(dir)}\n`);
  }
}
