import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

export default function test({ requirePackage, resolvePackage, run, projectDir, mode, portVersion }) {
  const testcafe = requirePackage('testcafe');
  const pkg = requirePackage('testcafe/package.json');
  if (mode !== 'baseline') {
    assert.equal(pkg.name, '@ohos-npm-ports/testcafe');
    assert.equal(pkg.version, portVersion);
  }
  const root = dirname(resolvePackage('testcafe/package.json'));
  const selector = testcafe.Selector('#example');
  const client = testcafe.ClientFunction(() => 42);
  const logger = testcafe.RequestLogger('http://example.invalid');
  assert.equal(typeof testcafe, 'function');
  assert.equal(typeof selector, 'function');
  assert.equal(typeof client, 'function');
  assert.ok(Array.isArray(logger.requests));
  if (process.platform === 'openharmony') {
    const providers = requirePackage(join(root, 'lib/browser/provider/built-in'));
    assert.equal(providers.chrome.supportMultipleWindows, true);
    assert.equal(typeof providers.chrome.takeScreenshot, 'function');
    assert.equal(providers.chrome, providers.haitai);
  }
  if (mode !== 'baseline' && process.platform === 'openharmony') {
    const testsDir = join(import.meta.dirname, 'tests');
    const env = {
      TESTCAFE_PACKAGE: root,
      NODE_PATH: [join(projectDir, 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(delimiter),
    };
    run(process.execPath, [join(testsDir, 'platforms.cjs')], { env });
    const tests = readdirSync(testsDir)
      .filter((file) => file.endsWith('.test.cjs') || file.endsWith('.test.mjs'))
      .sort()
      .map((file) => join(testsDir, file));
    run(process.execPath, ['--test', ...tests], { env });
  }
  run(process.execPath, [join(root, 'bin/testcafe.js'), '--version']);
  return {
    result: { selector: typeof selector, clientFunction: typeof client, requests: logger.requests },
    assets: [],
  };
}
