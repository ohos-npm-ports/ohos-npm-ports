const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAppServer } = require(require('node:path').join(process.env.NW_TEST_IMPL || require('node:path').join(__dirname, '../ohos'), 'server.cjs'));
async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-app-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'probe', main: 'index.html' }));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>probe</title>');
  fs.writeFileSync(path.join(dir, 'settings.json'), '{"answer":42}');
  const app = await createAppServer({ appDir: dir });
  t.after(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, app, rpc: async (module, method, args = [], headers = {}) => {
    const response = await fetch(`${app.baseURL}__rpc`, { method: 'POST', headers: {
      Origin: app.origin, 'Content-Type': 'application/json', 'X-NW-Token': app.config.token, ...headers,
    }, body: JSON.stringify({ module, method, args }) });
    return { status: response.status, body: await response.json() };
  } };
}
test('serves the manifest entry and returns real Node values', async t => {
  const { app, rpc } = await fixture(t);
  assert.match(await (await fetch(app.entryURL)).text(), /<title>probe/);
  assert.equal((await rpc('os', 'platform')).body.value, process.platform);
  assert.equal((await rpc('path', 'basename', ['/a/b.txt'])).body.value, 'b.txt');
  assert.equal((await rpc('fs', 'readFileSync', ['settings.json', 'utf8'])).body.value, '{"answer":42}');
  assert.deepEqual((await rpc('json', 'require', ['./settings.json'])).body.value, { answer: 42 });
});
test('writes only within the app and rejects unsupported APIs', async t => {
  const { rpc, dir } = await fixture(t);
  assert.equal((await rpc('fs', 'writeFileSync', ['output.txt', '你好'])).body.ok, true);
  assert.equal(fs.readFileSync(path.join(dir, 'output.txt'), 'utf8'), '你好');
  for (const [module, method, args] of [['fs', 'readFileSync', ['../secret', 'utf8']], ['path', 'constructor', []], ['child_process', 'exec', ['echo bad']]])
    assert.equal((await rpc(module, method, args)).body.ok, false);
});
test('rejects wrong token and foreign Origin', async t => {
  const { rpc } = await fixture(t);
  assert.equal((await rpc('os', 'platform', [], { 'X-NW-Token': 'bad' })).status, 403);
  assert.equal((await rpc('os', 'platform', [], { Origin: 'https://example.com' })).status, 403);
});
test('rejects symlink escape and unsupported manifest features', async t => {
  const { dir, rpc, app } = await fixture(t);
  fs.symlinkSync(os.tmpdir(), path.join(dir, 'outside'));
  assert.equal((await rpc('fs', 'readFileSync', ['outside/secret', 'utf8'])).body.ok, false);
  assert.equal((await fetch(`${app.baseURL}outside/secret`)).status, 403);
  fs.writeFileSync(path.join(dir, 'package.json'), '{"main":"https://example.com"}');
  await assert.rejects(() => createAppServer({ appDir: dir }), /local/);
});
test('never follows a dangling symlink when writing', async t => {
  const { dir, rpc } = await fixture(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const target = path.join(outside, 'forbidden.txt');
  fs.symlinkSync(target, path.join(dir, 'dangling'));
  assert.equal((await rpc('fs', 'writeFileSync', ['dangling', 'bad'])).body.ok, false);
  assert.equal(fs.existsSync(target), false);
});
test('nodejs:false also disables the server-side capability endpoint', async t => {
  const { dir } = await fixture(t);
  fs.writeFileSync(path.join(dir, 'package.json'), '{"main":"index.html","nodejs":false}');
  const app = await createAppServer({ appDir: dir });
  t.after(() => app.close());
  const response = await fetch(`${app.baseURL}__rpc`, { method: 'POST', headers: {
    Origin: app.origin, 'Content-Type': 'application/json', 'X-NW-Token': app.config.token,
  }, body: JSON.stringify({ module: 'os', method: 'platform', args: [] }) });
  assert.equal(response.status, 403);
});
