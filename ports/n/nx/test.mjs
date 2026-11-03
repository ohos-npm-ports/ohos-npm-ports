import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export default function test({ requirePackage, resolvePackage, run, projectDir }) {
  const packageRoot = path.dirname(resolvePackage('nx/package.json'));
  const binding = requirePackage(path.join(packageRoot, 'dist/src/native/native-bindings.js'));
  assert.equal(binding.IS_WASM, false);
  assert.ok(Object.keys(binding).length >= 50);
  const cli = path.join(packageRoot, 'dist/bin/nx.js');
  const directory = fs.mkdtempSync(path.join(projectDir, '.nx-test-'));
  const socket = fs.mkdtempSync(path.join(os.tmpdir(), 'nx-'));
  try {
    fs.mkdirSync(path.join(directory, 'packages/pkg-a'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: 'nx-ohos-smoke', private: true, workspaces: ['packages/*'] }));
    fs.writeFileSync(path.join(directory, 'nx.json'), '{}\n');
    fs.writeFileSync(path.join(directory, 'packages/pkg-a/package.json'), JSON.stringify({
      name: 'pkg-a', version: '1.0.0', scripts: { build: 'echo PKG_A_BUILT' },
    }));
    run('git', ['init', '-q', '.'], { cwd: directory });
    const options = { cwd: directory, capture: true, timeout: 120000, env: { NX_SOCKET_DIR: socket } };
    const output = run(process.execPath, [cli, 'run', 'pkg-a:build'], options);
    assert.match(output.stdout + output.stderr, /PKG_A_BUILT/);
    const projects = run(process.execPath, [cli, 'show', 'projects'], options);
    assert.match(projects.stdout + projects.stderr, /pkg-a/);
    const graph = path.join(directory, 'graph.json');
    run(process.execPath, [cli, 'graph', `--file=${graph}`], options);
    assert.ok(fs.statSync(graph).size > 0);
    run(process.execPath, [cli, 'reset'], options);
    return { result: { native: true, run: true, show: true, graph: true }, assets: [] };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(socket, { recursive: true, force: true });
  }
}
