import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export default async function test({ helper, importPackage, requirePackage, resolvePackage, run, projectDir, mode, portVersion }) {
  const tools = await import(helper);
  if (process.platform === 'win32') {
    const unsupported = tools.cli('tsrs', ['--version'], { codes: [1] });
    assert.match(unsupported.output, /Cannot find the optional dependency @tsrs\/win32-x64/);
    assert.match(unsupported.output, /This platform is not supported/);
    const metadata = await importPackage('tsrs');
    assert.match(metadata.version, /^0\.18\.0-/);
    return { result: { nativeSupport: false, unsupportedPlatformDiagnostic: true, metadata: true }, assets: [] };
  }
  tools.write('tsconfig.json', JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [] }, files: ['probe.ts'] }));
  tools.write('probe.ts', 'const answer: number = 42;');
  tools.cli('tsrs', ['--project', 'tsconfig.json']);
  tools.write('probe.ts', 'const answer: number = "wrong";');
  const invalid = tools.cli('tsrs', ['--project', 'tsconfig.json'], { codes: [2] });
  assert.match(invalid.output, /TS2322/);
  const { API } = await importPackage('tsrs/unstable/sync');
  const api = new API({ cwd: process.cwd() });
  try {
    const config = api.parseConfigFile(`${process.cwd()}/tsconfig.json`);
    assert.equal(config.fileNames.length, 1);
  } finally {
    api.close();
  }
  const { API: AsyncAPI } = await importPackage('tsrs/unstable/async');
  const asyncAPI = new AsyncAPI({ cwd: process.cwd() });
  try {
    const config = await asyncAPI.parseConfigFile(`${process.cwd()}/tsconfig.json`);
    assert.equal(config.fileNames.length, 1);
  } finally {
    await asyncAPI.close();
  }
  if (mode !== 'baseline') {
    const pkg = requirePackage('tsrs/package.json');
    assert.equal(pkg.name, '@ohos-npm-ports/tsrs');
    assert.equal(pkg.version, portVersion);
    const packageRoot = dirname(resolvePackage('tsrs/package.json'));
    const platform = await import(pathToFileURL(join(packageRoot, 'lib/platform.js')).href);
    assert.equal(platform.getPlatformPackageName('openharmony', 'arm64'), '@tsrs/openharmony-arm64');
    assert.equal(platform.getPlatformPackageName('darwin', 'arm64'), '@tsrs/darwin-arm64');
    assert.equal(platform.getPlatformPackageName('win32', 'x64'), '@tsrs/win32-x64');
    assert.match(platform.getPlatformPackageName('linux', 'arm64'), /^@tsrs\/linux-arm64-(gnu|musl)$/);
    if (process.platform === 'openharmony') {
      const nativeFile = resolvePackage('@tsrs/openharmony-arm64/package.json');
      assert.equal(requirePackage('@tsrs/openharmony-arm64/package.json').version, pkg.version);
      assert.ok(existsSync(join(dirname(nativeFile), 'tsrs')));
      assert.ok(existsSync(join(dirname(nativeFile), 'lib.es5.d.ts')));
      run(process.execPath, [join(import.meta.dirname, 'smoke.mjs'), projectDir], { cwd: projectDir });
      const smokeDir = mkdtempSync(join(projectDir, '.tsrs-upstream-'));
      try {
        const smoke = join(smokeDir, 'consumer.mjs');
        copyFileSync(join(import.meta.dirname, 'tests/upstream-smoke.mjs'), smoke);
        run(process.execPath, [smoke, join(projectDir, 'api-fixture')], { cwd: projectDir, timeout: 180000 });
      } finally {
        rmSync(smokeDir, { recursive: true, force: true });
      }
    }
  }
  return { result: { valid: true, invalid: 'TS2322', syncAPI: true, asyncAPI: true }, assets: [] };
}
