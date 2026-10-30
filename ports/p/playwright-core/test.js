// @test-package: playwright-core
// @test-format: cjs
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createServer } = require('node:http');
const { createRequire } = require('node:module');
const { dirname, join } = require('node:path');
const { writeFileSync } = require('node:fs');
const tools = createRequire(require.resolve('consumer-deps/package.json'));
const playwright = tools('playwright-core');
const manifest = tools('playwright-core/package.json');
const root = dirname(tools.resolve('playwright-core/package.json'));

(async () => {
  for (const name of ['chromium', 'firefox', 'webkit']) {
    assert.equal(playwright[name].name(), name);
    assert.equal(typeof playwright[name].launch, 'function');
  }
  assert.ok(playwright.devices['Desktop Chrome'].viewport.width > 0);
  const cli = execFileSync(process.execPath, [join(root, 'cli.js'), '--version'], { encoding: 'utf8', timeout: 30000 }).trim();
  assert.match(cli, /^Version 1\.64\.1(?:-\d+)?$/);
  const executable = playwright.chromium.executablePath();
  if (process.platform === 'openharmony') assert.ok(executable === 'aa' || executable.endsWith('/aa'));
  else assert.ok(executable && executable !== 'aa' && !executable.endsWith('/aa'));

  if (process.env.PORT_TEST_MODE === 'overrides') {
    assert.equal(manifest.name, '@ohos-npm-ports/playwright-core');
    const ohos = tools('playwright-core/lib/ohos');
    assert.equal(typeof ohos.launchViaAa, 'function');
    const helpers = Object.keys(ohos).filter(name => name !== 'default' && !(name in playwright)).sort();
    assert.deepEqual(helpers, [
      'ARK_WEB_BUNDLE_NAME', 'httpGetJson', 'launchViaAa', 'ohosInitScript',
      'resolveLaunchConfig', 'takeScreenshot', 'waitForEndpoint',
    ].sort());
    const image = Buffer.from('cdp-image');
    assert.equal(await ohos.takeScreenshot({ screenshot: async () => image }), image);
    const failure = Error('CDP failure');
    await assert.rejects(ohos.takeScreenshot({ screenshot: async () => { throw failure; } }), error => error === failure);
  }

  const server = createServer(async (req, res) => {
    try {
      const parts = [];
      for await (const part of req) parts.push(part);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Set-Cookie', 'consumer=playwright; Path=/; HttpOnly');
      res.end(JSON.stringify({ method: req.method, url: req.url,
        cookie: req.headers.cookie || '', data: parts.length ? JSON.parse(Buffer.concat(parts).toString()) : null }));
    } catch (error) { res.statusCode = 500; res.end(JSON.stringify({ error: error.message })); }
  });
  let context;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    context = await playwright.request.newContext({ baseURL: `http://127.0.0.1:${server.address().port}` });
    const get = await context.get('/probe?q=hello');
    assert.equal(get.status(), 200);
    assert.deepEqual(await get.json(), { method: 'GET', url: '/probe?q=hello', cookie: '', data: null });
    const data = { message: '鸿蒙 consumer', answer: 42 };
    const post = await context.post('/echo', { data });
    assert.equal(post.status(), 200);
    assert.deepEqual(await post.json(), { method: 'POST', url: '/echo', cookie: 'consumer=playwright', data });
    const storage = await context.storageState();
    assert.ok(storage.cookies.some(cookie => cookie.name === 'consumer' && cookie.value === 'playwright'));
    writeFileSync(process.env.PORT_TEST_REPORT, JSON.stringify({ result: {
      browsers: ['chromium', 'firefox', 'webkit'], cliVersion: '1.64.1',
      apiRequest: { get: true, jsonPost: true, cookies: true, storageState: true },
    }, assets: [] }));
  } finally {
    try { await context?.dispose(); }
    finally { await new Promise(resolve => server.close(resolve)); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
