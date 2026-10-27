// @test-package: nw
// @test-format: cjs
// @test-setup: true
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
if (process.env.PORT_TEST_PHASE === 'setup') {
  fs.writeFileSync('.npmrc', 'ignore-scripts=true\n');
  process.exit(0);
}
const tools = createRequire(require.resolve('consumer-deps/package.json'));
(async () => {
  const api = await import(require('node:url').pathToFileURL(tools.resolve('nw')).href);
  for (const name of ['get', 'run', 'findpath']) assert.equal(typeof api[name], 'function');
  const root = path.dirname(tools.resolve('nw/package.json'));
  const help = execFileSync(process.execPath, [path.join(root, 'src/cli.js'), '--help'], { encoding: 'utf8', timeout: 30000 });
  assert.match(help, /nw/i);
  if (process.platform === 'openharmony') await assert.rejects(api.findpath(), /No standalone/);
  else assert.match(await api.findpath(), /nwjs-v0\.119\.2/);
  if (process.env.PORT_TEST_MODE === 'overrides') {
    assert.equal(tools('nw/package.json').name, '@ohos-npm-ports/nw');
    const { createAppServer } = tools('nw/src/ohos/server.cjs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-consumer-'));
    fs.writeFileSync(path.join(dir, 'package.json'), '{"main":"index.html"}');
    fs.writeFileSync(path.join(dir, 'index.html'), '<title>nw consumer</title>');
    fs.writeFileSync(path.join(dir, 'data.json'), '{"answer":42}');
    let app;
    try {
      app = await createAppServer({ appDir: dir });
      assert.equal((await fetch(app.entryURL)).status, 200);
      const invoke = async (module, method, args) => {
        const response = await fetch(`${app.baseURL}__rpc`, { method: 'POST', headers: {
          Origin: app.origin, 'Content-Type': 'application/json', 'X-NW-Token': app.config.token,
        }, body: JSON.stringify({ module, method, args }) });
        return response.json();
      };
      assert.deepEqual((await invoke('json', 'require', ['./data.json'])).value, { answer: 42 });
      assert.equal((await invoke('os', 'platform', [])).value, process.platform);
      assert.equal((await invoke('fs', 'readFileSync', ['../escape', 'utf8'])).ok, false);
      const unauthorized = await fetch(`${app.baseURL}__rpc`, { method: 'POST', body: '{}' });
      assert.equal(unauthorized.status, 403);
    } finally { await app?.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  }
  fs.writeFileSync(process.env.PORT_TEST_REPORT, JSON.stringify({ result: { exports: ['get', 'run', 'findpath'], help: true, platformAPI: true }, assets: [] }));
})().catch(error => { console.error(error); process.exitCode = 1; });
