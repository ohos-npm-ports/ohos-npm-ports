// @test-package: next
// @test-timeout: 1800
// @test-project: next-react
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
const require = createRequire(import.meta.url);

(async () => {
  const tools = await import(process.env.PORT_TEST_HELPER);
  const pkg = require('next/package.json');
  if (process.env.PORT_TEST_MODE === 'overrides') {
    assert.equal(pkg.name, '@ohos-npm-ports/next');
    assert.equal(pkg.version, '14.2.28-2');
    assert.equal(pkg.scripts.prepublishOnly, undefined);
  }
  const local = createRequire(require.resolve('next/dist/build/swc'));
  if (process.platform === 'openharmony') {
    const slot = local('@ohos-npm-ports/next-swc-openharmony-arm64/package.json');
    assert.deepEqual(slot.os, ['openharmony']);
    assert.deepEqual(slot.cpu, ['arm64']);
    assert.equal(slot.version, pkg.version);
  } else {
    const abi = process.platform === 'linux' ? '-gnu' : process.platform === 'win32' ? '-msvc' : '';
    assert.ok(fs.existsSync(local.resolve(`@next/swc-${process.platform}-${process.arch}${abi}`)));
    assert.throws(() => local.resolve('@ohos-npm-ports/next-swc-openharmony-arm64'), { code: 'MODULE_NOT_FOUND' });
  }
  const binding = await require('next/dist/build/swc').loadBindings();
  assert.equal(binding.isWasm, false);
  const out = binding.transformSync('const answer: number = 21 * 2;', {
    filename: 'probe.ts', jsc: { parser: { syntax: 'typescript' } }, sourceMaps: false,
  });
  assert.doesNotMatch(out.code, /: number/);
  const answer = vm.runInNewContext(`${out.code}\nanswer`);
  assert.equal(answer, 42);
  const report = { result: { native: true, typescriptResult: answer }, assets: [] };
  if (process.env.PORT_TEST_PRIMARY === 'true') {
    await (await import(process.env.PORT_TEST_FRONTEND_HELPER)).verifyFrontend(report);
  }
  tools.report(report.result, report.assets);
})().catch((error) => { console.error(error); process.exitCode = 1; });
