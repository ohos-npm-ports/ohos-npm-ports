// @test-prerequisite: ports/d/domparser-rs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testFile = fileURLToPath(import.meta.url);
const runner = fileURLToPath(new URL('../../../cli/consumer-test-runner.mjs', import.meta.url));

export default async function test(context) {
  const moduleMode = process.env.UTOO_TEST_MODULE;
  const { mode, primary, projectDir, version, revision, npmCli, helper, requirePackage, importPackage } = context;
  if (!moduleMode) {
    const reports = fs.mkdtempSync(path.join(os.tmpdir(), 'utoo-pack-test-'));
    try {
      const result = {};
      for (const name of ['cjs', 'esm']) {
        const report = path.join(reports, `${name}.json`);
        const child = spawnSync(process.execPath, [runner, testFile, 'test', mode, String(primary), report], {
          cwd: projectDir,
          env: {
            ...process.env,
            UTOO_TEST_MODULE: name,
            PORT_TEST_VERSION: version,
            PORT_TEST_REVISION: revision,
            PORT_TEST_NPM_CLI: npmCli,
            PORT_TEST_HELPER: helper,
          },
          stdio: 'inherit',
          timeout: 240000,
        });
        assert.ifError(child.error);
        assert.equal(child.status, 0, `${name} build failed: ${child.signal}`);
        result[name] = JSON.parse(fs.readFileSync(report, 'utf8')).result;
      }
      return { result, assets: [] };
    } finally {
      fs.rmSync(reports, { recursive: true, force: true });
    }
  }

  assert.ok(['cjs', 'esm'].includes(moduleMode));
  const pkg = requirePackage('@utoo/pack/package.json');
  if (mode !== 'baseline') {
    assert.equal(pkg.name, '@ohos-npm-ports/utoo-pack');
    assert.equal(pkg.version, `${version}-${revision}`);
  }
  const api = moduleMode === 'cjs' ? requirePackage('@utoo/pack') : await importPackage('@utoo/pack');
  assert.equal(typeof api.build, 'function');
  assert.equal(typeof api.serve, 'function');
  const root = fs.mkdtempSync(path.join(projectDir, '.utoo-test-'));
  try {
    fs.writeFileSync(path.join(root, 'package.json'), '{"private":true}');
    fs.writeFileSync(path.join(root, 'entry.ts'), 'import "./style.css"; const proof: string = "utoo-native-proof"; document.body.dataset.port = proof; import("./lazy").then(m => document.body.dataset.lazy = m.lazy);');
    fs.writeFileSync(path.join(root, 'lazy.ts'), 'export const lazy: string = "utoo-lazy-proof";');
    fs.writeFileSync(path.join(root, 'style.css'), '.utoo-port { color: rgb(12, 34, 56); }');
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><html><head><title>native fixture</title></head><body><h1 class="utoo-port">utoo fixture</h1></body></html>');
    await api.build({ config: {
      entry: [{ name: 'main', import: './entry.ts', html: { template: path.join(root, 'index.html') } }],
      output: { path: `./dist-${moduleMode}`, clean: true },
      optimization: { minify: true },
    } }, root, root);
    const output = path.join(root, `dist-${moduleMode}`);
    const files = fs.readdirSync(output, { recursive: true }).filter(file => fs.statSync(path.join(output, file)).isFile());
    const scripts = files.filter(file => file.endsWith('.js')).map(file => fs.readFileSync(path.join(output, file), 'utf8')).join('\n');
    assert.ok(scripts.includes('utoo-native-proof'));
    assert.ok(scripts.includes('utoo-lazy-proof'));
    assert.ok(!scripts.includes('proof: string'));
    const css = files.filter(file => file.endsWith('.css')).map(file => fs.readFileSync(path.join(output, file), 'utf8')).join('\n');
    assert.ok(css.includes('.utoo-port'));
    const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
    assert.ok(html.includes('utoo fixture'));
    assert.match(html, /<script\b/);
    assert.match(html, /<link\b/);
    const assets = new Map(files.map(file => [`/${file.split(path.sep).join('/')}`, fs.readFileSync(path.join(output, file))]));
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
    return {
      result: { typescript: true, css: true, html: true, dynamicImport: true, httpAssets: true },
      assets: [],
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
