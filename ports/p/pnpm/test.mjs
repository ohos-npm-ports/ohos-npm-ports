import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const slotName = 'pnpm-exe.openharmony-arm64';

export default async function test({ requirePackage, resolvePackage, importPackage, run, mode, version, revision }) {
  const pkg = requirePackage('pnpm/package.json');
  if (mode === 'overrides') {
    assert.equal(pkg.name, '@ohos-npm-ports/pnpm');
    assert.equal(pkg.version, `${version}-${revision}`);
    assert.equal(pkg.optionalDependencies[`@ohos-npm-ports/${slotName}`], `${version}-${revision}`);
  } else {
    assert.equal(pkg.name, 'pnpm');
    assert.equal(pkg.version, version);
  }
  const native = await importPackage('pnpm/native-binary.mjs');
  const candidates = native.getBinCandidates();
  assert.ok(candidates.length > 0, 'no native binary candidate for the host');
  const expectedPrefix = process.platform === 'openharmony' ? '@ohos-npm-ports/pnpm-exe.' : '@pnpm/exe.';
  assert.ok(candidates.every((name) => name.startsWith(expectedPrefix)), JSON.stringify(candidates));
  const installedBinary = native.resolveInstalledBinary();
  assert.ok(installedBinary, 'installed native binary missing');
  assert.ok(existsSync(installedBinary));
  const root = dirname(resolvePackage('pnpm/package.json'));
  const binary = join(root, process.platform === 'win32' ? 'pnpm.exe' : 'pnpm');
  assert.ok(existsSync(binary));
  if (process.platform === 'openharmony') assert.equal(readFileSync(binary).subarray(0, 4).toString('hex'), '7f454c46');
  const output = run(binary, ['--version'], { capture: true }).stdout;
  assert.ok(output.includes(version), output);
  const smoke = mkdtempSync(join(tmpdir(), 'pnpm-port-'));
  try {
    writeFileSync(join(smoke, 'package.json'), JSON.stringify({ name: 'smoke' }));
    run(binary, ['install', '--lockfile-only'], { cwd: smoke });
    assert.ok(existsSync(join(smoke, 'pnpm-lock.yaml')));
  } finally {
    rmSync(smoke, { recursive: true, force: true });
  }
  return {
    result: { cliVersion: version, nativeLoader: true, lockfileOnlyInstall: true },
    assets: [],
  };
}
