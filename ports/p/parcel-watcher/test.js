// @test-package: @parcel/watcher
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const watcher = require('@parcel/watcher');
assert.equal(typeof watcher.writeSnapshot, 'function');

if (process.platform === 'openharmony') {
  const slot = require('@parcel/watcher-openharmony-arm64');
  assert.equal(typeof slot.writeSnapshot, 'function');
}

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'parcel-watcher-'));
const snapshot = path.join(os.tmpdir(), 'parcel-watcher-snapshot.txt');
try {
  fs.writeFileSync(path.join(directory, 'a.txt'), 'x');
  await watcher.writeSnapshot(directory, snapshot, {});
  assert.ok(fs.existsSync(snapshot), 'snapshot file missing');
  fs.writeFileSync(process.env.PORT_TEST_REPORT, JSON.stringify({
    result: { writeSnapshot: true },
    assets: [],
  }));
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
  fs.rmSync(snapshot, { force: true });
}
