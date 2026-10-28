const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const artifact = path.resolve(process.argv[2]);
const api = require(path.join(artifact, 'lib/ohos'));
test('only local launcher exports remain', () => {
  assert.equal(typeof api.launchViaAa, 'function');
  for (const name of ['HdcBackend', 'hdcScreenshot', 'launchViaHdc', 'resolveOhosAa'])
    assert.equal(name in api, false, name);
  for (const name of ['hdc.js', 'ohos-aa.js'])
    assert.equal(fs.existsSync(path.join(artifact, 'lib/ohos', name)), false);
});
test('screenshot uses CDP options and returns original result', async () => {
  const data = Buffer.from('image');
  const options = { type: 'jpeg', quality: 75 };
  const result = await api.takeScreenshot({ screenshot: async value => { assert.equal(value, options); return data; } }, options);
  assert.equal(result, data);
});
test('screenshot failure propagates without display capture fallback', async () => {
  const error = Error('CDP screenshot failed');
  await assert.rejects(api.takeScreenshot({ screenshot: async () => { throw error; } }), value => value === error);
});
for (const platform of ['linux', 'darwin', 'win32']) {
  test(`${platform} retains upstream executable resolution`, () => {
    execFileSync(process.execPath, ['-e', `
      Object.defineProperty(process, 'platform', { value: ${JSON.stringify(platform)} });
      const assert = require('node:assert/strict');
      const { chromium } = require(${JSON.stringify(artifact)});
      const executable = chromium.executablePath();
      assert.ok(executable && executable !== 'aa' && !executable.endsWith('/aa'));
    `], { stdio: 'pipe', timeout: 30000 });
  });
}

test('upstream in-process CDP transport still connects and disconnects', async () => {
  const { chromium } = require(artifact);
  const commands = [];
  const transport = {
    send(message) {
      commands.push(message.method);
      const result = message.method === 'Browser.getVersion'
        ? { product: 'Chrome/130.0.0.0', userAgent: 'Chrome/130.0.0.0', protocolVersion: '1.3' }
        : message.method === 'Target.getTargetInfo' ? { targetInfo: { targetId: 'browser', type: 'browser' } } : {};
      queueMicrotask(() => transport.onmessage({ id: message.id, result, sessionId: message.sessionId }));
    },
    close() { transport.onclose?.(); },
  };
  const browser = await chromium.connectOverCDP(transport, { timeout: 5000 });
  assert.equal(browser.isConnected(), true);
  assert.equal(browser.contexts().length, 1);
  await browser.close();
  assert.equal(browser.isConnected(), false);
  assert.ok(commands.includes('Browser.getVersion'));
  assert.ok(commands.includes('Target.setAutoAttach'));
});
