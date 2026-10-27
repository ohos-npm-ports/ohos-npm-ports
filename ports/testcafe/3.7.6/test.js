// @test-package: testcafe
// @test-format: cjs
const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');
const testcafe = require('testcafe');
const selector = testcafe.Selector('#example');
const client = testcafe.ClientFunction(() => 42);
const logger = testcafe.RequestLogger('http://example.invalid');
assert.equal(typeof testcafe, 'function');
assert.equal(typeof selector, 'function');
assert.equal(typeof client, 'function');
assert.ok(Array.isArray(logger.requests));
if (process.platform === 'openharmony') {
    const path = require('node:path');
    const root = path.dirname(require.resolve('testcafe/package.json'));
    const providers = require(path.join(root, 'lib/browser/provider/built-in'));
    assert.equal(providers.chrome.supportMultipleWindows, true);
    assert.equal(typeof providers.chrome.takeScreenshot, 'function');
    assert.equal(providers.chrome, providers.haitai);
}
writeFileSync(process.env.PORT_TEST_REPORT, JSON.stringify({
    result: { selector: typeof selector, clientFunction: typeof client, requests: logger.requests },
    assets: [],
}));
