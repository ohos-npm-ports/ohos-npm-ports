import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export default function test({ requirePackage, resolvePackage, run, version }) {
  const manifest = requirePackage('turbo/package.json');
  const cli = join(dirname(resolvePackage('turbo/package.json')), typeof manifest.bin === 'string' ? manifest.bin : manifest.bin.turbo);
  assert.equal(run(process.execPath, [cli, '--version'], { capture: true }).stdout.trim(), version);
  const smoke = mkdtempSync(join(tmpdir(), 'turbo-port-'));
  try {
    mkdirSync(join(smoke, 'packages', 'pkg-a', 'dist'), { recursive: true });
    mkdirSync(join(smoke, 'packages', 'pkg-b', 'dist'), { recursive: true });
    writeFileSync(join(smoke, 'package.json'), JSON.stringify({
      name: 'turbo-smoke', private: true, packageManager: 'npm@10.0.0', workspaces: ['packages/*'],
    }));
    writeFileSync(join(smoke, 'turbo.json'), JSON.stringify({ tasks: { build: { outputs: ['dist/**'] } } }));
    for (const name of ['pkg-a', 'pkg-b']) {
      writeFileSync(join(smoke, 'packages', name, 'dist', 'out.txt'), `built-by-${name}\n`);
      writeFileSync(join(smoke, 'packages', name, 'build.cjs'), `const fs = require('node:fs'); fs.mkdirSync('dist', { recursive: true }); fs.writeFileSync('dist/out.txt', 'built-by-${name}\\n');\n`);
      writeFileSync(join(smoke, 'packages', name, 'package.json'), JSON.stringify({
        name, version: '0.0.0', private: true,
        scripts: { build: 'node build.cjs' },
      }));
    }
    const execute = () => run(process.execPath, [cli, 'run', 'build'], {
      cwd: smoke,
      capture: true,
      env: { TURBO_TELEMETRY_DISABLED: '1' },
    });
    execute();
    const realBuild = execute();
    assert.match(`${realBuild.stdout}${realBuild.stderr}`, /cache miss, executing/);
    assert.equal(readFileSync(join(smoke, 'packages', 'pkg-a', 'dist', 'out.txt'), 'utf8'), 'built-by-pkg-a\n');
    assert.equal(readFileSync(join(smoke, 'packages', 'pkg-b', 'dist', 'out.txt'), 'utf8'), 'built-by-pkg-b\n');
    const cached = execute();
    assert.match(`${cached.stdout}${cached.stderr}`, /FULL TURBO/);
    return { result: { cliVersion: version, realBuild: true, fullTurbo: true }, assets: [] };
  } finally {
    rmSync(smoke, { recursive: true, force: true });
  }
}
