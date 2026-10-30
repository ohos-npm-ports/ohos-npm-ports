import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync, createWriteStream } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPort } from '../../cli/port.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const versions = JSON.parse(readFileSync(join(repo, '.github/scripts/tool-versions.json'), 'utf8'));
const scope = '@ohos-npm-ports/';

export function platformMatches(manifest, platform = process.platform, arch = process.arch) {
  const allowed = (values, current) => {
    if (!values || values.length === 0) return true;
    const list = Array.isArray(values) ? values : [values];
    if (list.includes(`!${current}`)) return false;
    const positive = list.filter((value) => !value.startsWith('!'));
    return positive.length === 0 || positive.includes(current);
  };
  return allowed(manifest.os, platform) && allowed(manifest.cpu, arch);
}

export function containsPackage(tree, name, version) {
  const visited = new Set();
  function visit(node) {
    if (!node || visited.has(node)) return false;
    visited.add(node);
    if (node.name === name && node.version === version) return true;
    if (node.resolved === `npm:${name}@${version}`) return true;
    const tarball = `${name}/-/${name.split('/').at(-1)}-${version}.tgz`;
    if (typeof node.resolved === 'string' && node.resolved.endsWith(tarball)) return true;
    return Object.values(node.dependencies ?? {}).some(visit);
  }
  return visit(tree);
}

export function validateBins(pkg, project) {
  const entries = typeof pkg.bin === 'string' ? { [basename(pkg.name)]: pkg.bin } : pkg.bin ?? {};
  for (const name of Object.keys(entries)) {
    assert.equal(basename(name), name, `Unsafe bin name: ${name}`);
    assert.ok(existsSync(join(project, 'node_modules', '.bin', name)), `Missing installed bin ${name} for ${pkg.name}`);
  }
}

function manifests(directory, selected) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return manifests(path, selected);
    if (entry.name !== 'manifest.json') return [];
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    if (!selected.has(manifest.portDir)) return [];
    assert.match(manifest.sourceSha, /^[a-f0-9]{40}$/);
    if (process.env.REPLAY_ARTIFACTS === 'true') {
      const args = ['-c', `safe.directory=${repo}`];
      try { execFileSync('git', [...args, 'cat-file', '-e', `${manifest.sourceSha}^{commit}`], { cwd: repo, stdio: 'ignore' }); }
      catch { execFileSync('git', [...args, 'fetch', '--no-tags', 'origin', manifest.sourceSha], { cwd: repo, stdio: 'inherit' }); }
      const inputs = (ref) => execFileSync('git', [...args, 'ls-tree', '-r', ref, '--', manifest.portDir], { cwd: repo, encoding: 'utf8' })
        .split('\n').filter((line) => line && !line.endsWith('/test.js')).join('\n');
      assert.equal(inputs('HEAD'), inputs(manifest.sourceSha), `Replayed build inputs changed: ${manifest.portDir}`);
    } else {
      assert.equal(manifest.sourceSha, process.env.GITHUB_SHA, `Artifact from a different commit: ${path}`);
    }
    return manifest.packages.map((pkg) => {
      assert.equal(pkg.filename, basename(pkg.filename));
      assert.match(pkg.filename, /\.tgz$/);
      assert.ok(pkg.name.startsWith(scope));
      const tarball = join(directory, pkg.filename);
      const integrity = `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`;
      assert.equal(integrity, pkg.integrity, `Artifact integrity mismatch: ${tarball}`);
      return { ...pkg, tarball, portDir: manifest.portDir };
    });
  });
}

function freePort() {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => error ? fail(error) : done(port));
    });
  });
}

async function main() {
  assert.equal(process.platform, process.env.EXPECTED_PLATFORM);
  assert.equal(process.arch, process.env.EXPECTED_ARCH);
  const selected = JSON.parse(process.env.CONSUMER_PORTS ?? '[]');
  assert.ok(Array.isArray(selected) && selected.length > 0, 'CONSUMER_PORTS must be a nonempty JSON array');
  assert.equal(new Set(selected).size, selected.length, 'Duplicate port selection');
  for (const dir of selected) assert.match(dir, /^ports\/[a-z0-9]\/[^/]+$/);
  const artifactRoot = resolve(process.argv[2] ?? '.port-artifacts');
  assert.ok(existsSync(artifactRoot), `Missing artifacts: ${artifactRoot}`);
  const artifacts = manifests(artifactRoot, new Set(selected));
  const temporary = mkdtempSync(join(tmpdir(), 'ohos-install-matrix-'));
  const registryLog = join(temporary, 'verdaccio.log');
  let registry;
  let registryStream;
  const environment = { ...process.env, npm_config_progress: 'false', npm_config_fetch_retries: '5' };
  try {
    const prefix = execFileSync('brew', ['--prefix', 'python'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const pythonBin = join(prefix, 'libexec', 'bin');
    if (existsSync(join(pythonBin, 'python'))) {
      environment.PYTHON ??= join(pythonBin, 'python');
      environment.PATH = `${pythonBin}:${environment.PATH ?? ''}`;
    }
  } catch { /* Non-brew hosts keep their existing Python configuration. */ }
  const run = (command, args, cwd, capture = false) => execFileSync(command, args, {
    cwd, env: environment, encoding: 'utf8', timeout: 1200000, maxBuffer: 20 * 1024 * 1024,
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
  let npmCli = process.platform === 'win32'
    ? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
    : execFileSync('sh', ['-c', 'command -v npm'], { encoding: 'utf8' }).trim();
  const npm = (args, cwd = temporary, capture = false) => run(process.execPath, [npmCli, ...args], cwd, capture);
  const saveLogs = () => {
    try {
      const destination = join(repo, '.install-matrix-logs');
      mkdirSync(destination, { recursive: true });
      if (existsSync(registryLog)) cpSync(registryLog, join(destination, 'verdaccio.log'));
      const npmLogs = join(temporary, 'npm-cache/_logs');
      if (existsSync(npmLogs)) cpSync(npmLogs, join(destination, 'npm-logs'), { recursive: true });
    } catch (error) { console.error(`Could not save logs: ${error.message}`); }
  };
  try {
    const tooling = join(temporary, 'tooling');
    npm(['install', '--prefix', tooling, '--no-audit', '--no-fund', `npm@${versions.npm}`, `verdaccio@${versions.verdaccio}`]);
    npmCli = join(tooling, 'node_modules/npm/bin/npm-cli.js');
    const registryAddress = `127.0.0.1:${await freePort()}`;
    const registryUrl = `http://${registryAddress}`;
    const config = join(temporary, 'config.yaml');
    writeFileSync(config, `storage: ${join(temporary, 'storage')}\nlisten: ${registryAddress}\nmax_body_size: 256mb\nauth:\n  htpasswd:\n    file: ${join(temporary, 'htpasswd')}\n    max_users: 1\nuplinks:\n  npmjs:\n    url: https://registry.npmjs.org/\npackages:\n  '**':\n    access: $all\n    publish: $authenticated\n    proxy: npmjs\n`);
    const registryPackage = JSON.parse(readFileSync(join(tooling, 'node_modules/verdaccio/package.json'), 'utf8'));
    const registryBin = typeof registryPackage.bin === 'string' ? registryPackage.bin : registryPackage.bin.verdaccio;
    registry = spawn(process.execPath, [join(tooling, 'node_modules/verdaccio', registryBin), '--config', config], {
      env: environment, stdio: ['ignore', 'pipe', 'pipe'],
    });
    registryStream = createWriteStream(registryLog);
    registry.stdout.pipe(registryStream, { end: false });
    registry.stderr.pipe(registryStream, { end: false });
    registry.on('close', () => registryStream.end());
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      assert.equal(registry.exitCode, null, 'Verdaccio exited before becoming ready');
      try {
        const response = await fetch(`${registryUrl}/-/ping`, { signal: AbortSignal.timeout(2000) });
        if (response.ok) { ready = true; break; }
      } catch { /* Registry is still starting. */ }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.ok(ready, 'Verdaccio did not become ready');
    const user = 'ci-publisher';
    const response = await fetch(`${registryUrl}/-/user/org.couchdb.user:${user}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _id: `org.couchdb.user:${user}`, name: user, password: 'local-registry-only', email: 'ci@example.invalid', type: 'user', roles: [], date: new Date().toISOString() }),
    });
    assert.ok(response.ok, `Registry user registration failed: ${response.status}`);
    const { token } = await response.json();
    assert.ok(token);
    const npmrc = join(temporary, 'npmrc');
    writeFileSync(npmrc, `registry=${registryUrl}/\n${scope}:registry=${registryUrl}/\n//${registryAddress}/:_authToken=${token}\n`, { mode: 0o600 });
    Object.assign(environment, {
      NPM_CONFIG_USERCONFIG: npmrc,
      NPM_CONFIG_REGISTRY: registryUrl,
      npm_config_registry: registryUrl,
      npm_config_cache: join(temporary, 'npm-cache'),
    });
    const published = new Map();
    for (const artifact of artifacts) {
      await npm(['publish', artifact.tarball, '--registry', registryUrl, '--access', 'public', '--tag', 'ci-artifact']);
      const metadata = JSON.parse(await npm(['view', `${artifact.name}@${artifact.version}`, '--json', '--registry', registryUrl], temporary, true));
      assert.ok(metadata.dist.tarball.startsWith(`${registryUrl}/`));
      assert.equal(metadata.dist.integrity, artifact.integrity);
      published.set(`${artifact.name}@${artifact.version}`, metadata);
    }
    for (const dir of selected) {
      const port = loadPort(repo, dir);
      const own = artifacts.filter((artifact) => artifact.portDir === dir);
      const mainName = `${scope}${port.pkgname}`;
      const main = own.find((artifact) => artifact.name === mainName);
      assert.ok(main, `${dir}: missing main artifact ${mainName}`);
      const project = mkdtempSync(join(temporary, 'project-'));
      writeFileSync(join(project, 'package.json'), `${JSON.stringify({
        name: 'generic-install-matrix', private: true,
        dependencies: { [port.upstream]: `npm:${main.name}@${main.version}` },
      }, null, 2)}\n`);
      console.log(`Installing ${dir} on ${process.platform}/${process.arch}`);
      await npm(['install', '--include=optional', '--foreground-scripts', '--no-audit', '--no-fund'], project);
      await npm(['ci', '--include=optional', '--foreground-scripts', '--no-audit', '--no-fund'], project);
      const mainManifest = JSON.parse(readFileSync(join(project, 'node_modules', port.upstream, 'package.json'), 'utf8'));
      assert.equal(mainManifest.name, main.name);
      assert.equal(mainManifest.version, main.version);
      validateBins(mainManifest, project);
      const tree = JSON.parse(await npm(['ls', '--all', '--json'], project, true));
      for (const artifact of own) {
        const metadata = published.get(`${artifact.name}@${artifact.version}`);
        if (!platformMatches(metadata)) {
          console.log(`Skipping ${artifact.name} on ${process.platform}/${process.arch} due to os/cpu filters`);
          continue;
        }
        assert.ok(containsPackage(tree, artifact.name, artifact.version), `${dir}: ${artifact.name}@${artifact.version} is missing after install`);
      }
      console.log(`PASS ${dir} on ${process.platform}/${process.arch}`);
      if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `PASS ${dir} on ${process.platform}/${process.arch}\n`);
    }
  } catch (error) {
    console.error(error);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `FAIL generic install matrix on ${process.platform}/${process.arch}: ${error.message}\n`);
    saveLogs();
    process.exitCode = 1;
  } finally {
    if (registry && registry.exitCode === null && registry.signalCode === null) {
      const closed = once(registry, 'close');
      registry.kill('SIGTERM');
      await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 5000))]);
      if (registry.exitCode === null && registry.signalCode === null) registry.kill('SIGKILL');
    }
    if (registryStream && !registryStream.closed) registryStream.end();
    try { rmSync(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }); }
    catch (error) { console.warn(`Could not remove ${temporary}: ${error.message}`); }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
