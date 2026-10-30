import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { registryConfig } from './consumer-registry.mjs';

const tools = process.env.CONSUMER_REGISTRY_TOOLS;
test('local artifact publish/install succeeds when the upstream has the same version', { skip: !tools, timeout: 120000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'consumer-registry-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const command = (file, args) => new Promise((done, fail) => {
    const child = spawn(process.execPath, [file, ...args], { cwd: root, env: { ...process.env, npm_config_cache: join(root, 'cache') }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', fail);
    child.on('close', (code) => code === 0 ? done(output) : fail(new Error(output)));
  });
  const npmCli = process.env.CONSUMER_REGISTRY_NPM_CLI;
  assert.ok(npmCli, 'CONSUMER_REGISTRY_NPM_CLI must name npm-cli.js');
  const name = '@ohos-npm-ports/registry-regression';
  const dependency = 'registry-proxy-regression';
  const version = '1.0.0';
  async function pack(pkg, dir) {
    const path = join(root, dir);
    mkdirSync(path);
    writeFileSync(join(path, 'package.json'), JSON.stringify(pkg));
    await command(npmCli, ['pack', path, '--pack-destination', root, '--ignore-scripts']);
    return readFileSync(join(root, `${pkg.name.replace('@', '').replace('/', '-')}-${version}.tgz`));
  }
  const artifact = await pack({ name, version, dependencies: { [dependency]: version } }, 'artifact');
  const dependencyTarball = await pack({ name: dependency, version }, 'dependency');
  const requests = [];
  let upstreamUrl;
  const upstream = createServer((req, res) => {
    const path = decodeURIComponent(req.url);
    requests.push(path);
    const pkg = path.startsWith(`/${name}`) ? name : dependency;
    const bytes = pkg === name ? artifact : dependencyTarball;
    if (path.endsWith('.tgz')) { res.end(bytes); return; }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ _id: pkg, name: pkg, 'dist-tags': { latest: version }, versions: {
      [version]: { name: pkg, version, dist: { tarball: `${upstreamUrl}/${pkg}/-/${pkg.split('/').at(-1)}-${version}.tgz`, shasum: createHash('sha1').update(bytes).digest('hex') } },
    } }));
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  t.after(() => { upstream.closeAllConnections(); upstream.close(); });
  upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
  assert.ok((await (await fetch(`${upstreamUrl}/${name}`)).json()).versions[version]);
  requests.length = 0;
  const config = join(root, 'config.yaml');
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const address = `127.0.0.1:${reservation.address().port}`;
  await new Promise((done) => reservation.close(done));
  writeFileSync(config, registryConfig(root, address, [{ name }]).replace('https://registry.npmjs.org/', `${upstreamUrl}/`));
  const pkgPath = resolve(tools, 'node_modules/verdaccio');
  const pkg = JSON.parse(readFileSync(join(pkgPath, 'package.json')));
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.verdaccio;
  const registry = spawn(process.execPath, [join(pkgPath, bin), '--config', config], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => {
    if (registry.exitCode === null) { const closed = once(registry, 'close'); registry.kill(); await closed; }
  });
  let log = '';
  registry.stdout.on('data', (chunk) => { log += chunk; });
  registry.stderr.on('data', (chunk) => { log += chunk; });
  let url;
  for (let i = 0; i < 100; i++) {
    url = log.match(/http:\/\/127\.0\.0\.1:(\d+)/)?.[0];
    if (url) {
      try { if ((await fetch(`${url}/-/ping`)).ok) break; } catch {}
      url = undefined;
    }
    assert.equal(registry.exitCode, null, log);
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.ok(url, log);
  const response = await fetch(`${url}/-/user/org.couchdb.user:ci`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'ci', password: 'test-password', email: 'ci@example.invalid' }) });
  assert.ok(response.ok, await response.clone().text());
  const { token } = await response.json();
  const npmrc = join(root, 'npmrc');
  writeFileSync(npmrc, `registry=${url}/\n//${url.slice(7)}/:_authToken=${token}\n`);
  const npm = (args) => command(npmCli, [...args, '--userconfig', npmrc, '--registry', url]);
  const tarball = join(root, 'ohos-npm-ports-registry-regression-1.0.0.tgz');
  await npm(['publish', tarball, '--tag', 'ci-artifact', '--access', 'public']);
  const metadata = JSON.parse(await npm(['view', `${name}@${version}`, 'dist', '--json']));
  assert.equal(metadata.integrity, `sha512-${createHash('sha512').update(artifact).digest('base64')}`);
  assert.ok(metadata.tarball.startsWith(`${url}/`));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, dependencies: { demo: `npm:${name}@${version}` } }));
  for (const verb of ['install', 'ci']) await npm([verb, '--no-audit', '--no-fund', '--ignore-scripts']);
  assert.equal(JSON.parse(readFileSync(join(root, 'node_modules/demo/package.json'))).name, name);
  assert.ok(requests.some((path) => path.startsWith(`/${dependency}`)), 'ordinary dependencies must use the upstream');
  assert.ok(!requests.some((path) => path.startsWith(`/${name}`)), 'artifact packages must never use the upstream');
});
