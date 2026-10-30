// @test-package: tsrs
import assert from 'node:assert/strict';

(async () => {
  const tools = await import(process.env.PORT_TEST_HELPER);
  if (process.platform === 'win32') {
    const unsupported = tools.cli('tsrs', ['--version'], { codes: [1] });
    assert.match(unsupported.output, /Cannot find the optional dependency @tsrs\/win32-x64/);
    assert.match(unsupported.output, /This platform is not supported/);
    const metadata = await import('tsrs');
    assert.match(metadata.version, /^0\.18\.0-/);
    tools.report({ nativeSupport: false, unsupportedPlatformDiagnostic: true, metadata: true });
    return;
  }
  tools.write('tsconfig.json', JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [] }, files: ['probe.ts'] }));
  tools.write('probe.ts', 'const answer: number = 42;');
  tools.cli('tsrs', ['--project', 'tsconfig.json']);
  tools.write('probe.ts', 'const answer: number = "wrong";');
  const invalid = tools.cli('tsrs', ['--project', 'tsconfig.json'], { codes: [2] });
  assert.match(invalid.output, /TS2322/);
  const { API } = await import('tsrs/unstable/sync');
  const api = new API({ cwd: process.cwd() });
  try {
    const config = api.parseConfigFile(`${process.cwd()}/tsconfig.json`);
    assert.equal(config.fileNames.length, 1);
  } finally { api.close(); }
  const { API: AsyncAPI } = await import('tsrs/unstable/async');
  const asyncAPI = new AsyncAPI({ cwd: process.cwd() });
  try {
    const config = await asyncAPI.parseConfigFile(`${process.cwd()}/tsconfig.json`);
    assert.equal(config.fileNames.length, 1);
  } finally { await asyncAPI.close(); }
  tools.report({ valid: true, invalid: 'TS2322', syncAPI: true, asyncAPI: true });
})().catch((error) => { console.error(error); process.exitCode = 1; });
