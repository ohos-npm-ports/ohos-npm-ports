import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { appendFileSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registryConfig } from '../.github/scripts/consumer-registry.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const registry = 'http://127.0.0.1:4873';
const delay = (ms) => new Promise((done) => setTimeout(done, ms));

export const packageName = (spec) => spec.slice(0, spec.lastIndexOf('@'));
export const artifactFilename = ({ name, version }) => `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`;

function run(command, args, { cwd = repo, env = process.env, capture = false, quiet = false, timeout = 0 } = {}) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { cwd, env, stdio: capture ? ['ignore', 'pipe', quiet ? 'ignore' : 'inherit'] : 'inherit' });
    let output = '';
    let settled = false;
    if (capture) child.stdout.on('data', (chunk) => { output += chunk; });
    const timer = timeout ? setTimeout(() => {
      settled = true;
      child.kill('SIGKILL');
      fail(new Error(`Command timed out after ${timeout}ms: ${command} ${args.join(' ')}`));
    }, timeout) : null;
    timer?.unref();
    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      if (!settled) fail(error);
    });
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      if (settled) return;
      if (code === 0) done(output);
      else fail(new Error(`${command} ${args.join(' ')} failed: ${signal ?? code}`));
    });
  });
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, 'close');
  child.kill('SIGTERM');
  if (!await Promise.race([closed.then(() => true), delay(5000).then(() => false)])) {
    child.kill('SIGKILL');
    await closed;
  }
}

function commandExists(command) {
  try {
    execFileSync('sh', ['-c', `command -v ${command}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export async function validatePublish(portArg) {
  const temporary = mkdtempSync(join(tmpdir(), 'ohos-port-registry-'));
  let verdaccio;
  const abort = () => {
    if (verdaccio) verdaccio.kill('SIGKILL');
    rmSync(temporary, { recursive: true, force: true });
    process.exit(1);
  };
  process.once('SIGHUP', abort);
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  try {
    if (commandExists('brew')) {
      const pythonBin = `${await run('brew', ['--prefix', 'python'], { capture: true })}/libexec/bin`;
      if (existsSync(join(pythonBin, 'python'))) {
        process.env.PYTHON = join(pythonBin, 'python');
        process.env.PATH = `${pythonBin}:${process.env.PATH}`;
      }
    }

    const portDir = resolve(portArg);
    const portRel = relative(repo, portDir);
    const artifacts = join(portDir, 'artifacts');
    mkdirSync(join(temporary, 'storage'), { recursive: true });
    mkdirSync(join(temporary, 'app'), { recursive: true });
    mkdirSync(join(temporary, 'bin'), { recursive: true });
    mkdirSync(join(temporary, 'consumer'), { recursive: true });
    mkdirSync(artifacts, { recursive: true });

    const expectedFile = join(temporary, 'expected-packages.txt');
    writeFileSync(expectedFile, '');
    const realNpm = execFileSync('sh', ['-c', 'command -v npm'], { encoding: 'utf8' }).trim();
    const shim = join(temporary, 'bin', 'npm');
    writeFileSync(shim, `#!/bin/sh
set -eu
if [ "\${1:-}" = publish ]; then
  shift
  exec "$REAL_NPM" publish "$@" --registry "$PORT_REGISTRY"
fi
exec "$REAL_NPM" "$@"
`, { mode: 0o755 });

    await run('cli/npm-ports', ['pack', portRel, '--no-build']);
    await run('cli/npm-ports', ['publish', portRel, '--dry-run'], {
      env: { ...process.env, PACKAGE_LIST: expectedFile },
    });
    const expected = readFileSync(expectedFile, 'utf8').split('\n').filter(Boolean);
    assert.ok(expected.length > 0, 'NPMBUILD did not declare any package');

    const versions = JSON.parse(readFileSync(join(repo, '.github/scripts/tool-versions.json'), 'utf8'));
    for (let attempt = 1; ; attempt++) {
      try {
        await run(realNpm, ['install', '--prefix', join(temporary, 'app'), '--no-audit', '--no-fund', '--fetch-retries=5', `verdaccio@${versions.verdaccio}`]);
        break;
      } catch (error) {
        if (attempt >= 3) throw error;
        await delay(attempt * 3000);
      }
    }

    const config = join(temporary, 'config.yaml');
    writeFileSync(config, registryConfig(temporary, '127.0.0.1:4873', expected.map((spec) => ({ name: packageName(spec) }))));
    const log = openSync(join(temporary, 'verdaccio.log'), 'w');
    verdaccio = spawn(join(temporary, 'app/node_modules/.bin/verdaccio'), ['--config', config], { stdio: ['ignore', log, log] });
    closeSync(log);

    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        await run('curl', ['-fsS', `${registry}/-/ping`], { capture: true, quiet: true });
        ready = true;
        break;
      } catch {
        if (verdaccio.exitCode !== null) break;
        await delay(1000);
      }
    }
    if (!ready) {
      if (existsSync(join(temporary, 'verdaccio.log'))) process.stderr.write(readFileSync(join(temporary, 'verdaccio.log')));
      throw new Error('Verdaccio did not become ready');
    }

    const user = 'ci-publisher';
    const registration = await run('curl', [
      '-fsS', '-X', 'PUT',
      '-H', 'Content-Type: application/json',
      '--data', JSON.stringify({
        _id: `org.couchdb.user:${user}`,
        name: user,
        password: 'local-registry-only',
        email: 'ci@example.invalid',
        type: 'user',
        roles: [],
        date: new Date().toISOString(),
      }),
      `${registry}/-/user/org.couchdb.user:${user}`,
    ], { capture: true });
    const token = JSON.parse(registration).token;
    assert.ok(token, 'Verdaccio did not return an authentication token');
    const npmrc = join(temporary, 'npmrc');
    writeFileSync(npmrc, `registry=${registry}/\n@ohos-npm-ports:registry=${registry}/\n//127.0.0.1:4873/:_authToken=${token}\n`);

    const packagesFile = join(temporary, 'packages.txt');
    writeFileSync(packagesFile, '');
    await run('cli/npm-ports', ['publish', portRel], {
      env: {
        ...process.env,
        PATH: `${join(temporary, 'bin')}:${process.env.PATH}`,
        REAL_NPM: realNpm,
        PORT_REGISTRY: registry,
        PACKAGE_LIST: packagesFile,
        NPM_CONFIG_USERCONFIG: npmrc,
      },
    });
    const actual = readFileSync(packagesFile, 'utf8').split('\n').filter(Boolean);
    assert.deepEqual(actual, expected, 'Published package list differs from dry-run');

    const packed = [];
    for (const spec of actual) {
      console.log(`Checking ${spec} from Verdaccio`);
      const tarball = JSON.parse(await run(realNpm, ['view', spec, 'dist.tarball', '--json', '--registry', registry], { capture: true }));
      assert.ok(tarball.startsWith(`${registry}/`), `Tarball is not from the temporary registry: ${tarball}`);
      console.log(tarball);

      const published = JSON.parse(await run(realNpm, ['view', spec, '--json', '--registry', registry], { capture: true }));
      const { name, version, dist } = published;
      assert.ok(dist.tarball.startsWith(`${registry}/`), 'Published tarball must come from this Verdaccio');
      const response = await fetch(dist.tarball, { signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw new Error(`Published tarball download failed: ${response.status}`);
      const data = Buffer.from(await response.arrayBuffer());
      const integrity = `sha512-${createHash('sha512').update(data).digest('base64')}`;
      assert.equal(integrity, dist.integrity, 'Downloaded artifact differs from the published tarball');
      const filename = artifactFilename({ name, version });
      writeFileSync(join(artifacts, filename), data);
      packed.push({ name, version, filename, integrity });
      console.log(`Exported published tarball: ${name}@${version}; ${integrity}`);

      await run(realNpm, ['install', '--foreground-scripts', '--no-audit', '--no-fund', '--registry', registry, spec], {
        cwd: join(temporary, 'consumer'),
        env: { ...process.env, NPM_CONFIG_USERCONFIG: npmrc },
        timeout: 1200000,
      });
    }

    writeFileSync(join(artifacts, 'manifest.json'), `${JSON.stringify({ sourceSha: process.env.GITHUB_SHA, portDir: portRel, packages: packed }, null, 2)}\n`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `artifact-name=port-${basename(portDir)}\n`);
    console.log(`Verdaccio publish and consumer install succeeded for:\n${actual.join('\n')}`);
  } finally {
    await stop(verdaccio);
    rmSync(temporary, { recursive: true, force: true });
    process.removeListener('SIGHUP', abort);
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  validatePublish(process.argv[2]).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
