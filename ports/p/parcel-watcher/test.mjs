import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export default async function test({ requirePackage }) {
  const watcher = requirePackage('@parcel/watcher');
  assert.equal(typeof watcher.writeSnapshot, 'function');
  if (process.platform === 'openharmony') {
    const slot = requirePackage('@parcel/watcher-openharmony-arm64');
    assert.equal(typeof slot.writeSnapshot, 'function');
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'parcel-watcher-'));
  const snapshot = path.join(os.tmpdir(), 'parcel-watcher-snapshot.txt');
  try {
    fs.writeFileSync(path.join(directory, 'a.txt'), 'x');
    await watcher.writeSnapshot(directory, snapshot, {});
    assert.ok(fs.existsSync(snapshot), 'snapshot file missing');
    return { result: { writeSnapshot: true }, assets: [] };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(snapshot, { force: true });
  }
}
