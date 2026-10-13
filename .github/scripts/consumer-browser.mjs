import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer, request } from 'node:http';
import { connect } from 'node:net';
import { mkdtempSync, openSync, writeFileSync, existsSync, readFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testSpec } from './consumer-plan.mjs';

const script = fileURLToPath(import.meta.url);
if (process.argv[2] === 'serve') {
  const app = process.argv[3];
  const local = createRequire(join(app, 'package.json'));
  const { chromium } = local('playwright-core');
  const child = spawn(chromium.executablePath(), ['--headless', '--no-sandbox', '--disable-dev-shm-usage', '--remote-debugging-port=9223', `--user-data-dir=${join(app, 'profile')}`], { stdio: 'inherit' });
  const server = createServer((incoming, outgoing) => {
    const proxy = request({ hostname: '127.0.0.1', port: 9223, path: incoming.url, method: incoming.method, headers: { ...incoming.headers, host: 'localhost:9223' } }, (response) => {
      if (incoming.url === '/json/version/') {
        let body = '';
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => {
          const metadata = JSON.parse(body);
          metadata.webSocketDebuggerUrl = metadata.webSocketDebuggerUrl.replace(/localhost:9223|127\.0\.0\.1:9223/, incoming.headers.host);
          outgoing.writeHead(response.statusCode, { 'Content-Type': 'application/json' });
          outgoing.end(JSON.stringify(metadata));
        });
      } else { outgoing.writeHead(response.statusCode, response.headers); response.pipe(outgoing); }
    });
    proxy.on('error', (error) => { outgoing.writeHead(502); outgoing.end(error.message); });
    incoming.pipe(proxy);
  });
  server.on('upgrade', (incoming, socket, head) => {
    const upstream = connect(9223, '127.0.0.1', () => {
      upstream.write(`${incoming.method} ${incoming.url} HTTP/${incoming.httpVersion}\r\n`);
      for (const [name, value] of Object.entries(incoming.headers)) upstream.write(`${name}: ${name === 'host' ? 'localhost:9223' : value}\r\n`);
      upstream.write('\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(socket); socket.pipe(upstream);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
    socket.on('close', () => upstream.destroy());
  });
  for (let i = 0; ; i++) {
    assert.ok(i < 120 && child.exitCode === null, 'Chromium failed to become ready');
    try { if ((await fetch('http://127.0.0.1:9223/json/version/', { signal: AbortSignal.timeout(1000) })).ok) break; } catch { }
    await new Promise((done) => setTimeout(done, 500));
  }
  await new Promise((done) => server.listen(9222, process.argv[5], done));
  writeFileSync(process.argv[4], 'ready');
  const close = () => { child.kill('SIGKILL'); server.close(); process.exit(); };
  process.on('SIGTERM', close); process.on('SIGINT', close);
  child.on('exit', close);
} else {
  if (!testSpec(process.argv[2])?.browser) process.exit(0);
  const app = mkdtempSync(join(tmpdir(), 'consumer-browser-'));
  const npmCli = process.platform === 'win32' ? join(resolve(process.execPath, '..'), 'node_modules/npm/bin/npm-cli.js') : execFileSync('sh', ['-c', 'command -v npm'], { encoding: 'utf8' }).trim();
  execFileSync(process.execPath, [npmCli, 'install', '--prefix', app, '--no-audit', '--no-fund', `playwright-core@${JSON.parse(readFileSync(join(script, '../tool-versions.json'), 'utf8'))['playwright-core']}`], { stdio: 'inherit', timeout: 300000 });
  execFileSync(process.execPath, [join(app, 'node_modules/playwright-core/cli.js'), 'install', ...(process.platform === 'linux' ? ['--with-deps'] : []), 'chromium'], { stdio: 'inherit', timeout: 600000 });
  const log = openSync('.consumer-browser.log', 'a');
  const ready = resolve('.consumer-browser.ready');
  const bind = process.argv[3] === 'container' ? execFileSync('docker', ['network', 'inspect', 'bridge', '--format', '{{(index .IPAM.Config 0).Gateway}}'], { encoding: 'utf8' }).trim() : '127.0.0.1';
  const child = spawn(process.execPath, [script, 'serve', app, ready, bind], { detached: true, stdio: ['ignore', log, log] });
  writeFileSync('.consumer-browser.pid', String(child.pid)); child.unref();
  for (let i = 0; !existsSync(ready); i++) {
    assert.ok(i < 150, existsSync('.consumer-browser.log') ? readFileSync('.consumer-browser.log', 'utf8') : 'Browser service timeout');
    await new Promise((done) => setTimeout(done, 500));
  }
  const host = process.argv[3] === 'container' ? 'host.docker.internal' : '127.0.0.1';
  appendFileSync(process.env.GITHUB_ENV, `PORT_TEST_BROWSER_ENDPOINT=http://${host}:9222\n`);
}
