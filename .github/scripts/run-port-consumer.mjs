import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync, appendFileSync, createWriteStream } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registryConfig } from './consumer-registry.mjs';
import { testSpec, closure } from './consumer-plan.mjs';
import { installedPackage } from './installed-package.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const fixture = join(repo, '.github/fixtures/consumer');
const versions = JSON.parse(readFileSync(join(repo, '.github/scripts/tool-versions.json'), 'utf8'));
const logDirectory = resolve(process.env.CONSUMER_LOG_DIR ?? '.consumer-logs');
const caseDirectories = [];
const artifactRoot = resolve(process.argv[2] ?? '.port-artifacts');
assert.equal(process.platform, process.env.EXPECTED_PLATFORM);
assert.equal(process.arch, process.env.EXPECTED_ARCH);
let npmCli = process.platform === 'win32'
  ? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
  : realpathSync(execFileSync('sh', ['-c', 'command -v npm'], { encoding: 'utf8' }).trim());
assert.ok(existsSync(npmCli), `Missing npm CLI: ${npmCli}`);
const temporary = mkdtempSync(join(tmpdir(), 'ohos-port-consumer-'));
const children = new Set();
let environment = { ...process.env, NEXT_TELEMETRY_DISABLED: '1', npm_config_progress: 'false', npm_config_fetch_retries: '5', npm_config_fetch_retry_mintimeout: '2000' };
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const group = (title) => console.log(`::group::${title}`);
const endGroup = () => console.log('::endgroup::');
async function retry(label, action, attempts = 3) {
  for (let attempt = 1; ; attempt++) {
    try { return await action(); } catch (error) {
      if (attempt >= attempts) throw error;
      console.warn(`${label} failed (attempt ${attempt}/${attempts}): ${error.message}`);
      await delay(attempt * 3000);
    }
  }
}

// Keep what is needed to diagnose a failure before the temporary tree is removed.
function saveLogs() {
  try {
    mkdirSync(logDirectory, { recursive: true });
    if (existsSync(registryLog)) cpSync(registryLog, join(logDirectory, 'verdaccio.log'));
    const npmLogs = join(temporary, 'npm-cache/_logs');
    if (existsSync(npmLogs)) cpSync(npmLogs, join(logDirectory, 'npm-logs'), { recursive: true });
    for (const directory of caseDirectories) {
      const tests = join(directory, '.port-tests');
      if (existsSync(tests)) cpSync(tests, join(logDirectory, 'cases', relative(temporary, directory)), { recursive: true });
    }
  } catch (error) { console.error(`Could not save diagnostic logs: ${error.message}`); }
}

function run(args, cwd, capture = false, extraEnv = {}, timeout = 0) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, args, {
      cwd, env: { ...environment, ...extraEnv }, stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    });
    children.add(child);
    let output = '';
    if (capture) child.stdout.on('data', (chunk) => { output += chunk; });
    const timer = timeout ? setTimeout(() => { child.kill('SIGKILL'); fail(new Error(`Command timed out after ${timeout}ms: ${args.join(' ')}`)); }, timeout) : null;
    child.on('error', (error) => { clearTimeout(timer); fail(error); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      children.delete(child);
      if (code === 0) done(output);
      else fail(new Error(`${args.join(' ')} failed: ${signal ?? code}`));
    });
  });
}
const npm = (args, cwd, capture = false) => run([npmCli, ...args], cwd, capture);

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, 'close');
  child.kill('SIGTERM');
  if (!await Promise.race([closed.then(() => true), delay(5000).then(() => false)])) {
    child.kill('SIGKILL');
    await closed;
  }
  children.delete(child);
}

async function freePort() {
  const server = createServer();
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}

function manifests(directory, required) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return manifests(path, required);
    if (entry.name !== 'manifest.json') return [];
    const manifest = JSON.parse(readFileSync(path));
    if (!required.has(manifest.portDir)) return [];
    assert.match(manifest.sourceSha, /^[a-f0-9]{40}$/);
    assert.match(manifest.portDir, /^ports\/[a-z0-9]\/[^/]+$/);
    if (process.env.REPLAY_ARTIFACTS === 'true') {
      const gitArgs = ['-c', `safe.directory=${repo}`];
      try { execFileSync('git', [...gitArgs, 'cat-file', '-e', `${manifest.sourceSha}^{commit}`], { cwd: repo, stdio: 'ignore' }); }
      catch { execFileSync('git', [...gitArgs, 'fetch', '--no-tags', 'origin', manifest.sourceSha], { cwd: repo, stdio: 'inherit' }); }
      const inputs = (ref) => execFileSync('git', [...gitArgs, 'ls-tree', '-r', ref, '--', manifest.portDir], { cwd: repo, encoding: 'utf8' })
        .split('\n').filter((line) => line && !line.endsWith('/test.js')).join('\n');
      const current = inputs('HEAD');
      assert.ok(current, `Missing build inputs: ${manifest.portDir}`);
      assert.equal(inputs(manifest.sourceSha), current, `Replayed build inputs changed: ${manifest.portDir}`);
      console.log(`Reusing ${manifest.portDir} from ${manifest.sourceSha}: build inputs identical`);
    } else {
      assert.equal(manifest.sourceSha, process.env.GITHUB_SHA, `Artifact from a different commit: ${path}`);
    }
    return manifest.packages.map((pkg) => {
      assert.equal(pkg.filename, basename(pkg.filename));
      assert.match(pkg.filename, /\.tgz$/);
      assert.match(pkg.name, /^@ohos-npm-ports\//);
      const tarball = join(directory, pkg.filename);
      const integrity = `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`;
      assert.equal(integrity, pkg.integrity, `Artifact integrity mismatch: ${tarball}`);
      return { ...pkg, tarball, portDir: manifest.portDir };
    });
  });
}

function artifactFor(built, spec) {
  const matches = built.filter((pkg) => pkg.portDir === spec.portDir && pkg.name === spec.portPackage);
  assert.equal(matches.length, 1, `Missing/ambiguous artifact for ${spec.portDir}: ${spec.portPackage}`);
  return matches[0];
}

function checkInstalled(project, built, registry, overridden, specs) {
  const require = createRequire(join(project, 'package.json'));
  const tools = createRequire(require.resolve('consumer-deps/package.json'));
  assert.deepEqual(tools('./package.json').dependencies, Object.fromEntries(specs.map((spec) => [spec.upstream, spec.version])));
  const lock = JSON.parse(readFileSync(join(project, 'package-lock.json')));
  for (const spec of specs) {
    const { path, manifest: installed } = installedPackage(tools, spec.upstream);
    const port = artifactFor(built, spec);
    assert.equal(installed.name, overridden ? port.name : spec.upstream);
    assert.equal(installed.version, overridden ? port.version : spec.version);
    if (overridden) {
      const key = relative(realpathSync(project), realpathSync(dirname(path))).split(sep).join('/');
      assert.ok(lock.packages[key], `Missing lock entry for installed package: ${key}`);
      assert.ok(lock.packages[key].resolved.startsWith(`${registry}/`));
      assert.equal(lock.packages[key].integrity, port.integrity);
    }
  }
}

async function portTests(project, specs, mode, primary, phase = 'test') {
  const reports = {};
  const testDir = join(project, '.port-tests');
  mkdirSync(testDir, { recursive: true });
  for (const [index, spec] of specs.filter((entry) => phase === 'setup' ? entry.setup : entry.portDir === primary || entry.role === 'support').entries()) {
    const test = join(testDir, `${phase}-${index}.${spec.format === 'esm' ? 'mjs' : 'cjs'}`);
    const report = join(testDir, `${phase}-${index}.json`);
    cpSync(spec.file, test);
    console.log(`Port ${phase}: ${spec.portDir} (${mode})`);
    await run([test], project, false, { PORT_TEST_PHASE: phase, PORT_TEST_MODE: mode, PORT_TEST_REPORT: report, PORT_TEST_PRIMARY: String(spec.portDir === primary), PORT_TEST_PORT_VERSION: spec.portVersion, PORT_TEST_NPM_CLI: npmCli, PORT_TEST_HELPER: pathToFileURL(join(fixture, 'test-tools.mjs')).href }, spec.timeout * 1000);
    if (phase === 'setup') continue;
    const result = JSON.parse(readFileSync(report));
    assert.ok(result.result && typeof result.result === 'object', `Invalid report from ${spec.portDir}`);
    result.assets ??= [];
    reports[spec.portDir] = result;
  }
  return reports;
}


let verdaccio;
let registryStream;
const registryLog = join(temporary, 'verdaccio.log');
try {
  const selected = process.env.CONSUMER_PORT ? [process.env.CONSUMER_PORT] : JSON.parse(process.env.CONSUMER_PORTS ?? '[]');
  assert.equal(selected.length, 1, 'Each consumer job must validate exactly one primary port');
  const cases = selected.map((dir) => {
    const spec = testSpec(dir);
    assert.ok(spec, `Missing test.js: ${dir}`);
    return spec;
  });
  const orderedDirs = closure(selected);
  assert.ok(existsSync(artifactRoot), `Missing pre-release artifacts: ${artifactRoot}; inspect producer publish/upload steps`);
  const built = manifests(artifactRoot, new Set(orderedDirs));
  for (const dir of orderedDirs) assert.ok(built.some((pkg) => pkg.portDir === dir), `Missing prerequisite artifact: ${dir}`);
  const rank = new Map(orderedDirs.map((dir, index) => [dir, index]));
  built.sort((a, b) => (rank.get(a.portDir) ?? rank.size) - (rank.get(b.portDir) ?? rank.size));
  const npmRuntime = join(temporary, 'npm-runtime');
  await retry('npm tool install', () => npm(['install', '--prefix', npmRuntime, '--no-audit', '--no-fund', `npm@${versions.npm}`], temporary));
  npmCli = join(npmRuntime, 'node_modules/npm/bin/npm-cli.js');
  console.log(`Using npm ${String(await npm(['--version'], temporary, true)).trim()}`);
  const registry = `http://127.0.0.1:${await freePort()}`;
  const app = join(temporary, 'registry-app');
  mkdirSync(app);
  await retry('verdaccio install', () => npm(['install', '--prefix', app, '--no-audit', '--no-fund', `verdaccio@${versions.verdaccio}`], temporary));
  const config = join(temporary, 'config.yaml');
  writeFileSync(config, registryConfig(temporary, registry.slice(7), built));
  const packageJson = JSON.parse(readFileSync(join(app, 'node_modules/verdaccio/package.json')));
  const log = registryStream = createWriteStream(registryLog);
  const verdaccioBin = typeof packageJson.bin === 'string' ? packageJson.bin : packageJson.bin.verdaccio;
  assert.equal(typeof verdaccioBin, 'string', 'Missing Verdaccio CLI entry');
  verdaccio = spawn(process.execPath, [join(app, 'node_modules/verdaccio', verdaccioBin), '--config', config], {
    env: environment, stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(verdaccio);
  verdaccio.stdout.pipe(log, { end: false });
  verdaccio.stderr.pipe(log, { end: false });
  verdaccio.on('close', () => log.end());
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    assert.equal(verdaccio.exitCode, null, 'Verdaccio exited before becoming ready');
    try {
      const response = await fetch(`${registry}/-/ping`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) { ready = true; break; }
    } catch { /* The registry may still be starting. */ }
    await delay(500);
  }
  assert.ok(ready, 'Verdaccio did not become ready');
  const user = 'ci-publisher';
  const response = await fetch(`${registry}/-/user/org.couchdb.user:${user}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ _id: `org.couchdb.user:${user}`, name: user, password: 'local-registry-only', email: 'ci@example.invalid', type: 'user', roles: [], date: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error(`User registration failed: ${response.status} ${await response.text()}`);
  const { token } = await response.json();
  assert.ok(token);
  const npmrc = join(temporary, 'npmrc');
  writeFileSync(npmrc, `registry=${registry}/\n@ohos-npm-ports:registry=${registry}/\n//${registry.slice(7)}/:_authToken=${token}\n`, { mode: 0o600 });
  environment = { ...environment, NPM_CONFIG_USERCONFIG: npmrc, NPM_CONFIG_REGISTRY: registry, npm_config_registry: registry, npm_config_cache: join(temporary, 'npm-cache') };
  for (const pkg of built) {
    await npm(['publish', pkg.tarball, '--registry', registry, `--@ohos-npm-ports:registry=${registry}`, '--access', 'public', '--tag', 'ci-artifact'], temporary);
    const dist = JSON.parse(await npm(['view', `${pkg.name}@${pkg.version}`, 'dist', '--json', '--registry', registry], temporary, true));
    assert.ok(dist.tarball.startsWith(`${registry}/`));
    assert.equal(dist.integrity, pkg.integrity, 'Registry must serve exactly the built tarball');
  }
  const modes = process.platform === 'openharmony' ? ['overrides'] : ['baseline', 'overrides'];
  if (process.platform === 'openharmony') console.log('Upstream native bindings may not support OpenHarmony; validating override consumers only');
  for (const [index, entry] of cases.entries()) {
    assert.ok(entry.platforms.includes(process.platform), `${entry.portDir} must pass every matrix OS; unsupported ${process.platform}: ${entry.reason ?? 'no reason'}`);
    const testSpecs = closure([entry.portDir]).map(testSpec).filter(Boolean);
    const specs = testSpecs.filter((spec) => spec.role !== 'support');
    assert.equal(new Set(specs.map((spec) => spec.upstream)).size, specs.length, 'Conflicting dependency specs in one consumer');
    const label = entry.portDir;
    for (const spec of specs) artifactFor(built, spec);
    const template = entry.fixture;
    const base = join(temporary, `case-${index}`);
    const toolchain = join(base, 'toolchain');
    mkdirSync(toolchain, { recursive: true });
    writeFileSync(join(toolchain, 'package.json'), JSON.stringify({
      name: 'consumer-deps', version: '1.0.0', private: true,
      dependencies: Object.fromEntries(specs.map((spec) => [spec.upstream, spec.version])),
    }));
    const packed = JSON.parse(await npm(['pack', '--json', '--pack-destination', base], toolchain, true))[0];
    const results = [];
    for (const mode of modes) {
      const project = join(base, mode);
      cpSync(template, project, { recursive: true });
      caseDirectories.push(project);
      cpSync(join(base, packed.filename), join(project, packed.filename));
      const pkg = JSON.parse(readFileSync(join(project, 'package.json')));
      if (mode === 'baseline') delete pkg.overrides;
      else pkg.overrides = Object.fromEntries(specs.map((spec) => {
        const port = artifactFor(built, spec);
        return [spec.upstream, `npm:${port.name}@${port.version}`];
      }));
      writeFileSync(join(project, 'package.json'), JSON.stringify(pkg, null, 2));
      console.log(`Testing ${label} / ${entry.project} / ${mode}: ${process.platform}/${process.arch}`);
      console.log(`Node ${process.version}; original dependencies: ${JSON.stringify(specs.map((spec) => [spec.upstream, spec.version]))}; overrides: ${JSON.stringify(pkg.overrides ?? {})}`);
      group(`${label} / ${mode}: setup, install and npm ci`);
      await portTests(project, testSpecs, mode, entry.portDir, 'setup');
      await npm(['install', '--include=optional', '--no-audit', '--no-fund'], project);
      await npm(['ci', '--include=optional', '--no-audit', '--no-fund'], project);
      checkInstalled(project, built, registry, mode === 'overrides', specs);
      endGroup();
      group(`${label} / ${mode}: port tests`);
      const reports = await portTests(project, testSpecs, mode, entry.portDir);
      endGroup();
      results.push(Object.fromEntries(Object.entries(reports).map(([key, report]) => [key, report.result])));
    }
    if (results.length === 2) assert.deepEqual(results[0], results[1], `Override results differ from upstream: ${label}`);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `PASS ${label} / ${entry.project} on ${process.platform}/${process.arch}\n`);
  }
  const result = `PASS ${process.platform}/${process.arch}: ${modes.join(' + ')} install, npm ci and port-defined tests\n`;
  console.log(result);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, result);
} catch (error) {
  endGroup();
  console.error(error);
  const failed = `FAIL ${process.env.CONSUMER_PORT ?? '?'} on ${process.platform}/${process.arch}: ${String(error?.message ?? error).split('\n')[0]}`;
  console.log(`::error::${failed}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${failed}\n`);
  if (existsSync(registryLog)) console.error(`Verdaccio log (last 200 lines; full log in the consumer-logs artifact):\n${readFileSync(registryLog, 'utf8').split('\n').slice(-200).join('\n')}`);
  saveLogs();
  process.exitCode = 1;
} finally {
  for (const child of [...children]) await stop(child);
  if (registryStream && !registryStream.closed) {
    const closed = once(registryStream, 'close');
    registryStream.end();
    await closed;
  }
  // Windows can keep native files (e.g. engines) locked briefly; cleanup must not fail a passed run.
  try { rmSync(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }); }
  catch (error) { console.warn(`::warning::Could not remove ${temporary}: ${error.message}`); }
}
