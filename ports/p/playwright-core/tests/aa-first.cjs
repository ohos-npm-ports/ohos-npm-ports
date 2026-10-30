const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const input = path.resolve(process.argv[2]);
function harness({ aa = true, start = true, ready = true, native = true, reject = false, options = {}, validCdp = true, wrapper = false } = {}) {
  const calls = [];
  const utils = {
    isOpenHarmony: () => native,
    resolveCommandPath: name => { assert.equal(name, 'aa'); return aa ? '/usr/bin/aa' : undefined; },
    getFreePort: async () => 19333,
    execFileAsync: async (command, args) => {
      assert.ok(command === '/usr/bin/aa' || command === 'sh');
      calls.push([command, ...args]);
      if (wrapper && command !== 'sh') throw Object.assign(Error('ENOEXEC'), { code: 'ENOEXEC' });
      if (reject) throw Error('aa permission denied');
      return { stdout: start ? 'start ability successfully.' : 'error: failed', stderr: '', code: 0 };
    },
    waitForEndpoint: async () => { if (!ready) throw Error('local CDP unavailable'); },
    httpGetJson: async () => validCdp ? { Browser: 'Chrome/test', webSocketDebuggerUrl: 'ws://127.0.0.1:19333/devtools/browser/test' } : {},
  };
  let code = fs.readFileSync(input, 'utf8');
  if (input.endsWith('.ts')) {
    code = require('node:module').stripTypeScriptTypes(code);
    code = code.replace(/import \{([^}]+)\} from '([^']+)';/g, 'const {$1} = require("$2");')
      .replace(/export const /g, 'const ');
    code += '\nmodule.exports = { launchViaAa };';
  }
  const sandbox = { require: name => {
    assert.equal(name, './utils', `unexpected dependency ${name}`);
    return utils;
  }, module: { exports: {} }, process: { env: {} }, console };
  vm.runInNewContext(code, sandbox, { filename: input });
  let closes = 0;
  const browser = { options: { browserProcess: {
    close: async () => calls.push('disconnect'), kill: async () => calls.push('disconnect'), onclose: () => closes++
  } }, _session: { send: async method => calls.push(method) } };
  const chromium = { _connectOverCDPInternal: async (_, endpoint, options) => {
    calls.push(endpoint); browser.connectOptions = options; return browser;
  } };
  return { calls, browser, closes: () => closes, run: () => sandbox.module.exports.launchViaAa(chromium, { race: p => p }, options) };
}
test('launches through local aa and connects directly over CDP', async () => {
  const h = harness(); await h.run();
  assert.equal(h.calls[0][1], 'start');
  assert.ok(h.calls.includes('http://127.0.0.1:19333'));
  assert.equal(h.browser.connectOptions.__ohosDeviceBrowser, true);
  assert.equal(h.browser.connectOptions.__ohosNoDefaultContext, true);
});
for (const [name, options, message] of [
  ['missing aa', { aa: false }, /aa.*not found/],
  ['aa failure text at exit zero', { start: false }, /aa start failed/],
  ['aa permission denial', { reject: true }, /permission denied/],
  ['CDP unavailable', { ready: false }, /CDP.*unavailable/],
  ['non-CDP endpoint', { validCdp: false }, /not a CDP/],
  ['non-OHOS host', { native: false }, /OpenHarmony/],
  ['socket browser', { options: { channel: 'huaweiBrowser' } }, /TCP CDP/],
]) test(`${name} fails without another backend`, async () => {
  const h = harness(options); await assert.rejects(h.run(), message);
  assert.ok(!h.calls.includes('Browser.close'));
});
test('preserves port, flags and URL as separate arguments', async () => {
  const h = harness({ options: { harmonyDebugPort: 19444, harmonyArgs: ['--test=one;two'], harmonyLaunchUrl: 'https://example.test/?a=1&b=2' } });
  await h.run(); const start = h.calls[0];
  assert.match(start[start.indexOf('--ps') + 2], /--test=one;two/);
  assert.match(start[start.indexOf('--ps') + 2], /--remote-debugging-port=19444/);
  assert.equal(start[start.indexOf('-U') + 1], 'https://example.test/?a=1&b=2');
});
test('ENOEXEC retries the same aa wrapper using sh, not another backend', async () => {
  const h = harness({ wrapper: true }); await h.run();
  assert.equal(h.calls[1][0], 'sh');
  assert.deepEqual(h.calls[1].slice(1), h.calls[0]);
});
test('close/kill close via CDP and notify once', async () => {
  const h = harness(); await h.run();
  await h.browser.options.browserProcess.close(); await h.browser.options.browserProcess.kill();
  assert.equal(h.calls.filter(c => c === 'Browser.close').length, 1);
  assert.equal(h.closes(), 1);
});
