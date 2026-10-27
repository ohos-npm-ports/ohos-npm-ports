const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const input = path.resolve(process.argv[2]);
function harness({ aa = true, start = true, ready = true, socket = false, connect = true, native = true, reject = false, options = {}, validCdp = true, wrapper = false } = {}) {
  const calls = [];
  const result = stdout => ({ stdout, stderr: '', code: 0 });
  class HdcBackend {
    constructor() { calls.push('hdc:construct'); this.binary = 'fake-hdc'; }
    async ensureDeviceConnected() { calls.push('hdc:detect'); }
    async cleanupStaleForwards() {}
    async shell(command) {
      calls.push(`hdc:${command}`);
      if (command.startsWith('bm ')) return result(command);
      if (command.includes('/proc/net/unix')) return result('@webview_devtools_remote_123');
      if (command === 'ps -ef') return result('123 browser');
      return result('start ability successfully.');
    }
    async fport() { calls.push('hdc:forward'); }
    async close() { calls.push('hdc:close'); }
  }
  const utils = {
    isOpenHarmony: () => native,
    resolveCommandPath: name => name === 'aa' && aa ? '/usr/bin/aa' : undefined,
    getFreePort: async () => 19333,
    execFileAsync: async (command, args) => {
      calls.push([command === 'sh' ? 'sh' : 'aa', ...args]);
      if (wrapper && command !== 'sh') throw Object.assign(new Error('spawn ENOEXEC'), { code: 'ENOEXEC' });
      if (reject) throw new Error('aa permission denied');
      return result(start ? 'start ability successfully.' : 'error: failed to start ability.');
    },
    waitForEndpoint: async url => {
      calls.push(`probe:${url}`);
      if (!ready && !calls.includes('hdc:forward')) throw new Error('local CDP unavailable');
    },
    httpGetJson: async () => validCdp ? { Browser: "Chrome/test", webSocketDebuggerUrl: "ws://127.0.0.1:19333/devtools/browser/test" } : {},
    ohosLog() {}, sleep: async () => {},
  };
  const mocks = {
    './hdc': { HdcBackend },
    './utils': utils,
    './ohos-aa': { resolveOhosAa: () => { calls.push("ohos-aa:resolve"); return undefined; }, execOhosAa: async () => { throw new Error('unexpected ohos-aa'); } },
  };
  let code = fs.readFileSync(input, 'utf8');
  if (input.endsWith('.ts')) {
    code = require('node:module').stripTypeScriptTypes(code);
    code = code.replace(/import \{([^}]+)\} from '([^']+)';/g, 'const {$1} = require("$2");')
      .replace(/export const /g, 'const ');
    code += '\nmodule.exports = { launchViaHdc };';
  }
  const sandbox = { require: name => {
    assert.ok(mocks[name], `unexpected require ${name}`);
    return mocks[name];
  }, module: { exports: {} }, process: { env: {} }, setInterval, clearInterval, console };
  vm.runInNewContext(code, sandbox, { filename: input });
  let onclose = 0;
  const browser = {
    options: { browserProcess: { close: async () => {}, kill: async () => {}, onclose: () => onclose++ } },
    _session: { send: async method => calls.push(`cdp:${method}`) },
  };
  const chromium = { _connectOverCDPInternal: async (_, url, options) => {
    calls.push('connect');
    if (!connect) throw new Error('CDP handshake failed');
    browser.connectOptions = options;
    return browser;
  } };
  return { calls, browser, onclose: () => onclose, run: () => sandbox.module.exports.launchViaHdc(chromium, { race: p => p }, socket ? { channel: 'huaweiBrowser' } : options) };
}

test('local aa connects directly without constructing or invoking hdc', async () => {
  const h = harness();
  await h.run();
  const start = h.calls.find(c => Array.isArray(c) && c[1] === 'start');
  assert.ok(start, 'local aa start was not called');
  assert.equal(start[start.indexOf('--ps') + 1], 'cmdArgs');
  assert.match(start[start.indexOf('--ps') + 2], /--remote-debugging-port=19333/);
  assert.ok(h.calls.includes('probe:http://127.0.0.1:19333/json/version'));
  assert.ok(!h.calls.includes('hdc:construct'));
  assert.ok(!h.calls.includes('ohos-aa:resolve'));
  assert.equal(h.browser.connectOptions.__ohosHdcBackend, undefined);
  assert.equal(h.browser.connectOptions.__ohosDeviceBrowser, true);
  await h.browser.options.browserProcess.close();
  assert.ok(h.calls.includes('cdp:Browser.close'));
  assert.ok(!h.calls.includes('hdc:close'));
  assert.equal(h.onclose(), 1);
});

test('missing aa falls back to hdc', async () => {
  const h = harness({ aa: false });
  await h.run();
  assert.ok(h.calls.includes('hdc:detect'));
  assert.ok(h.calls.includes('hdc:forward'));
});

for (const [name, options] of [['aa rejects start at exit zero', { start: false }], ['aa cannot execute', { reject: true }], ['aa starts but CDP is unavailable', { ready: false }], ['HTTP endpoint is not CDP', { validCdp: false }]]) {
  test(`${name}: only then detects hdc`, async () => {
    const h = harness(options);
    await h.run();
    const start = h.calls.findIndex(c => Array.isArray(c) && c[1] === 'start');
    assert.ok(start >= 0);
    assert.ok(h.calls.indexOf('hdc:construct') > start);
    assert.ok(h.calls.includes('hdc:detect'));
  });
}

test('Unix socket browsers retain hdc path', async () => {
  const h = harness({ socket: true });
  await h.run();
  assert.ok(!h.calls.some(Array.isArray));
  assert.ok(h.calls.includes('hdc:forward'));
});


test('preserves caller port, flags and URL without shell interpretation', async () => {
  const h = harness({ options: { harmonyDebugPort: 19444, harmonyArgs: ['--test-flag=one;two'], harmonyLaunchUrl: 'https://example.test/?a=1&b=2' } });
  await h.run();
  const start = h.calls.find(Array.isArray);
  assert.match(start[start.indexOf('--ps') + 2], /--test-flag=one;two/);
  assert.match(start[start.indexOf('--ps') + 2], /--remote-debugging-port=19444/);
  assert.equal(start[start.indexOf('-U') + 1], 'https://example.test/?a=1&b=2');
});

test('non-OHOS host does not invoke local aa', async () => {
  const h = harness({ native: false });
  await h.run();
  assert.ok(!h.calls.some(Array.isArray));
  assert.ok(h.calls.includes('hdc:detect'));
});

test('local browser kill closes through CDP and reports close only once', async () => {
  const h = harness();
  await h.run();
  await h.browser.options.browserProcess.kill();
  await h.browser.options.browserProcess.close();
  assert.equal(h.calls.filter(c => c === 'cdp:Browser.close').length, 1);
  assert.equal(h.onclose(), 1);
  assert.ok(!h.calls.includes('hdc:construct'));
});


test('ENOEXEC aa wrapper is run by sh with separate arguments', async () => {
  const h = harness({ wrapper: true });
  await h.run();
  const calls = h.calls.filter(Array.isArray);
  assert.equal(calls.length, 2);
  assert.equal(calls[1][0], 'sh');
  assert.equal(calls[1][1], '/usr/bin/aa');
  assert.deepEqual(calls[1].slice(2), calls[0].slice(1));
  assert.ok(!h.calls.includes('hdc:construct'));
});
