// @test-package: @utoo/pack
// @test-format: cjs
// @test-prerequisite: ports/d/domparser-rs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createServer } = require('node:http');
const { spawnSync } = require('node:child_process');
(async () => {
  const mode = process.env.UTOO_TEST_MODULE;
  if (!mode) {
    const result = {};
    // CJS and ESM register separate worker schedulers, so exercise them in isolated processes.
    for (const name of ['cjs', 'esm']) {
      const report = `${process.env.PORT_TEST_REPORT}.${name}.json`;
      const child = spawnSync(process.execPath, [__filename], {
        env: { ...process.env, UTOO_TEST_MODULE: name, PORT_TEST_REPORT: report },
        stdio: 'inherit', timeout: 240000,
      });
      assert.ifError(child.error);
      assert.equal(child.status, 0, `${name} build failed: ${child.signal}`);
      result[name] = JSON.parse(fs.readFileSync(report, 'utf8')).result;
    }
    fs.writeFileSync(process.env.PORT_TEST_REPORT, JSON.stringify({ result, assets: [] }));
    return;
  }
  assert(['cjs', 'esm'].includes(mode));
  const pkg = require('@utoo/pack/package.json');
  if (process.env.PORT_TEST_MODE === 'overrides') {
    assert.equal(pkg.name, '@ohos-npm-ports/utoo-pack');
    assert.equal(pkg.version, process.env.PORT_TEST_PORT_VERSION);
  }
  const api = mode === 'cjs' ? require('@utoo/pack') : await import('@utoo/pack');
  assert.equal(typeof api.build, 'function');
  assert.equal(typeof api.serve, 'function');
  const root = fs.mkdtempSync(path.join(process.cwd(), '.utoo-test-'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"private":true}');
  fs.writeFileSync(path.join(root, 'entry.ts'), 'import "./style.css"; const proof: string = "utoo-native-proof"; document.body.dataset.port = proof; import("./lazy").then(m => document.body.dataset.lazy = m.lazy);');
  fs.writeFileSync(path.join(root, 'lazy.ts'), 'export const lazy: string = "utoo-lazy-proof";');
  fs.writeFileSync(path.join(root, 'style.css'), '.utoo-port { color: rgb(12, 34, 56); }');
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><html><head><title>native fixture</title></head><body><h1 class="utoo-port">utoo fixture</h1></body></html>');
  {
    await api.build({ config: {
      entry: [{ name: 'main', import: './entry.ts', html: { template: path.join(root, 'index.html') } }],
      output: { path: `./dist-${mode}`, clean: true },
      optimization: { minify: true },
    } }, root, root);
    const output = path.join(root, `dist-${mode}`);
    const files = fs.readdirSync(output, { recursive: true }).filter(f => fs.statSync(path.join(output, f)).isFile());
    const scripts = files.filter(f => f.endsWith('.js')).map(f => fs.readFileSync(path.join(output, f), 'utf8')).join('\n');
    assert(scripts.includes('utoo-native-proof'));
    assert(scripts.includes('utoo-lazy-proof'));
    assert(!scripts.includes('proof: string'));
    const css = files.filter(f => f.endsWith('.css')).map(f => fs.readFileSync(path.join(output, f), 'utf8')).join('\n');
    assert(css.includes('.utoo-port'));
    const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
    assert(html.includes('utoo fixture'));
    assert.match(html, /<script\b/);
    assert.match(html, /<link\b/);
    const assets = new Map(files.map(f => [`/${f.split(path.sep).join('/')}`, fs.readFileSync(path.join(output, f))]));
    const server = createServer((request, response) => {
      const asset = assets.get(request.url);
      response.writeHead(asset ? 200 : 404);
      response.end(asset);
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    try {
      for (const [url, content] of assets) {
        const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`);
        assert.equal(response.status, 200);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), content);
      }
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  }
  fs.writeFileSync(process.env.PORT_TEST_REPORT, JSON.stringify({
    result: { typescript: true, css: true, html: true, dynamicImport: true, httpAssets: true },
    assets: [],
  }));
})().catch(error => { console.error(error); process.exitCode = 1; });
