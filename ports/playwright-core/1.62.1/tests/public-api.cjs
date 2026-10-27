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
