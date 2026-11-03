import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { statSync } from 'node:fs';

export default function test({ resolvePackage }) {
  if (process.platform !== 'openharmony') return { result: { openHarmonySlot: false }, assets: [] };
  const main = resolvePackage('next/package.json');
  const loaderRequire = createRequire(join(dirname(main), 'dist/build/swc/index.js'));
  const slotPackage = '@ohos-npm-ports/next-swc-openharmony-arm64';
  const slot = loaderRequire.resolve(`${slotPackage}/package.json`);
  assert.ok(statSync(join(dirname(slot), 'next-swc.openharmony-arm64.node')).size > 0);
  return { result: { openHarmonySlot: true }, assets: [] };
}
