const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { installBridge } = require(require('node:path').join(process.env.NW_TEST_IMPL || require('node:path').join(__dirname, '../ohos'), 'browser.cjs'));
function page(origin = 'http://127.0.0.1:1234', nodejs = true) {
  const calls = [];
  const context = { location: { origin, pathname: '/secret/index.html', reload() {} }, document: { readyState: 'complete', title: '' }, queueMicrotask, addEventListener() {}, XMLHttpRequest: class {
    open(method, url, async) { assert.equal(method, 'POST'); assert.equal(async, false); this.url = url; }
    setRequestHeader() {}
    send(body) { const request = JSON.parse(body); calls.push(request); this.status = 200; this.responseText = JSON.stringify({ ok: true, value: request.method === 'platform' ? 'openharmony' : 'real node value' }); }
  } };
  context.window = context; context.top = context;
  vm.createContext(context);
  vm.runInContext(`(${installBridge.toString()})(${JSON.stringify({ origin: 'http://127.0.0.1:1234', prefix: '/secret/', token: 'token', metadata: { nodejs, platform: 'openharmony', arch: 'arm64', node: '26', root: '/app', dirname: '/app', argv: [] } })})`, context);
  return { context, calls };
}
test('provides synchronous limited Node calls without fabricating an NW version', () => {
  const { context, calls } = page();
  assert.equal(context.require('node:os').platform(), 'openharmony');
  assert.equal(context.require('fs').readFileSync('a', 'utf8'), 'real node value');
  assert.equal(context.process.versions.nw, undefined);
  assert.ok(calls.length === 2);
});
test('does not expose capabilities to other origins or nodejs:false', () => {
  assert.equal(page('https://example.com').context.require, undefined);
  assert.equal(page(undefined, false).context.require, undefined);
});
test('rejects unsupported modules and window operations', () => {
  const { context } = page();
  assert.throws(() => context.require('child_process'), /Unsupported/);
  assert.throws(() => context.nw.Window.get().on('close', () => {}), /Unsupported/);
  assert.equal(context.nw.Window.get().title, '');
});
