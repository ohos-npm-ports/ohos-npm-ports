// @test-setup: true
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function setup() {
  fs.writeFileSync('.npmrc', 'ignore-scripts=true\n');
}

export default async function test({ importPackage, requirePackage, resolvePackage, run, mode }) {
  const api = await importPackage('nw');
  for (const name of ['get', 'run', 'findpath']) assert.equal(typeof api[name], 'function');
  const root = path.dirname(resolvePackage('nw/package.json'));
  const help = execFileSync(process.execPath, [path.join(root, 'src/cli.js'), '--help'], { encoding: 'utf8', timeout: 30000 });
  assert.match(help, /nw/i);
  if (process.platform === 'openharmony') await assert.rejects(api.findpath(), /No standalone/);
  else assert.match(await api.findpath(), /nwjs-v0\.119\.2/);
  if (mode === 'overrides') {
    assert.equal(requirePackage('nw/package.json').name, '@ohos-npm-ports/nw');
    const tests = path.join(import.meta.dirname, 'tests');
    run(process.execPath, [path.join(tests, 'dispatch.cjs'), path.join(root, 'src/index.js')]);
    for (const name of ['server', 'browser', 'endpoint']) {
      run(process.execPath, [path.join(tests, `${name}.cjs`)], { env: { NW_TEST_IMPL: path.join(root, 'src/ohos') } });
    }
    const { createAppServer } = requirePackage('nw/src/ohos/server.cjs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-consumer-'));
    fs.writeFileSync(path.join(dir, 'package.json'), '{"main":"index.html"}');
    fs.writeFileSync(path.join(dir, 'index.html'), '<title>nw consumer</title>');
    fs.writeFileSync(path.join(dir, 'data.json'), '{"answer":42}');
    let app;
    try {
      app = await createAppServer({ appDir: dir });
      assert.equal((await fetch(app.entryURL)).status, 200);
      const invoke = async (module, method, args) => {
        const response = await fetch(`${app.baseURL}__rpc`, { method: 'POST', headers: {
          Origin: app.origin, 'Content-Type': 'application/json', 'X-NW-Token': app.config.token,
        }, body: JSON.stringify({ module, method, args }) });
        return response.json();
      };
      assert.deepEqual((await invoke('json', 'require', ['./data.json'])).value, { answer: 42 });
      assert.equal((await invoke('os', 'platform', [])).value, process.platform);
      assert.equal((await invoke('fs', 'readFileSync', ['../escape', 'utf8'])).ok, false);
      const unauthorized = await fetch(`${app.baseURL}__rpc`, { method: 'POST', body: '{}' });
      assert.equal(unauthorized.status, 403);
    } finally {
      await app?.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  return { result: { exports: ['get', 'run', 'findpath'], help: true, platformAPI: true }, assets: [] };
}
