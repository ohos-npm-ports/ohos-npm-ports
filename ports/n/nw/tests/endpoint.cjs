const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateEndpoint, validateVersion } = require(require('node:path').join(process.env.NW_TEST_IMPL || require('node:path').join(__dirname, '../ohos'), 'runtime.cjs'));
test('only loopback HTTP endpoints are accepted', () => {
  assert.equal(validateEndpoint('http://127.0.0.1:9222'), 'http://127.0.0.1:9222');
  for (const url of ['https://example.com', 'http://example.com:9222', 'http://user:pass@127.0.0.1:9222', 'http://127.0.0.1:9222/proxy'])
    assert.throws(() => validateEndpoint(url), /loopback/);
});
test('validates the actual browser identity and WebSocket origin', () => {
  const version = { Browser: 'Chrome/132', 'User-Agent': 'Chrome/132 htbrowser/2', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/test' };
  assert.equal(validateVersion(version, 'http://127.0.0.1:9222'), version.webSocketDebuggerUrl);
  assert.throws(() => validateVersion({ ...version, webSocketDebuggerUrl: 'ws://example.com/test' }, 'http://127.0.0.1:9222'), /loopback/);
  assert.throws(() => validateVersion({ ...version, 'User-Agent': 'Chrome' }, 'http://127.0.0.1:9222'), /Haitai/);
});
