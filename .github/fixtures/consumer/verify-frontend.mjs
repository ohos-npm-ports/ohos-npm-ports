import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, 'close');
  child.kill('SIGTERM');
  if (!await Promise.race([closed.then(() => true), delay(5000).then(() => false)])) {
    child.kill('SIGKILL');
    await closed;
  }

}

async function freePort() {
  const server = createServer();
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}

export async function verifyFrontend(report) {
  const project = process.cwd();
  const scenario = JSON.parse(readFileSync(join(project, "scenario.json")));
  const reports = { primary: report };
  await new Promise((done, fail) => {
    const child = spawn(process.execPath, [process.env.PORT_TEST_NPM_CLI, 'run', 'build'], { cwd: project, stdio: 'inherit' });
    child.on('error', fail);
    child.on('close', (code) => code === 0 ? done() : fail(new Error(`Frontend build failed: ${code}`)));
  });
  const port = await freePort();
  const server = spawn(process.execPath, ['start.mjs', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: project, env: process.env, stdio: 'inherit',
  });

  try {
    let html;
    for (let attempt = 0; attempt < 120; attempt++) {
      assert.equal(server.exitCode, null, 'Production server exited before becoming ready');
      try {
        const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) });
        if (response.ok) { html = await response.text(); break; }
      } catch { /* The server may still be starting. */ }
      await delay(500);
    }
    assert.ok(html, 'Production server did not become ready');
    for (const marker of scenario.htmlIncludes) assert.ok(html.includes(marker), `Missing HTML marker: ${marker}`);
    const assets = [...(scenario.assets ?? []), ...Object.values(reports).flatMap((report) => report.assets)];
    for (const pattern of scenario.htmlAssets ?? []) {
      const match = html.match(new RegExp(pattern.pattern));
      assert.ok(match, `Missing generated HTML asset: ${pattern.pattern}`);
      assets.push({ ...pattern, path: match[1].replaceAll('&amp;', '&') });
    }
    for (const asset of assets) {
      const response = await fetch(new URL(asset.path, `http://127.0.0.1:${port}`));
      assert.equal(response.status, 200, `Asset not served: ${asset.path}`);
      const body = Buffer.from(await response.arrayBuffer());
      if (asset.includes) assert.ok(body.toString().includes(asset.includes), `Wrong content: ${asset.path}`);
      if (asset.magic) assert.ok(body.toString('hex').startsWith(asset.magic), `Wrong binary magic: ${asset.path}`);
      assert.ok(body.length >= (asset.minBytes ?? 1));
    }
    console.log('Production page and generated frontend assets served successfully');
  } finally {
    await stop(server);
  }

}
