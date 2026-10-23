import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const tools = createRequire(require.resolve('consumer-deps/package.json'));
const result = spawnSync(process.execPath, [tools.resolve('next/dist/bin/next'), 'build'], {
  stdio: 'inherit',
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
});
if (result.error) throw result.error;
assert.equal(result.status, 0, `next build failed: ${result.signal ?? result.status}`);
