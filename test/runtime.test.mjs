import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';

const execute = promisify(execFile);
const runtime = fileURLToPath(new URL('../cli/runtime.sh', import.meta.url));

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'npm-ports-runtime-'));
  const source = join(root, 'source', 'package');
  const archive = join(root, 'archive.tgz');
  const bin = join(root, 'bin');
  const cache = join(root, 'cache');
  const curlLog = join(root, 'curl.log');
  mkdirSync(source, { recursive: true });
  mkdirSync(bin);
  writeFileSync(join(source, 'content.txt'), 'payload\n');
  writeFileSync(join(source, 'excluded.txt'), 'excluded\n');
  execFileSync('tar', ['-czf', archive, '-C', dirname(source), 'package']);
  const sha256 = createHash('sha256').update(readFileSync(archive)).digest('hex');
  writeFileSync(curlLog, '');
  writeFileSync(join(bin, 'curl'), `#!/bin/sh
output=
url=
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) output="$2"; shift 2 ;;
    http*) url="$1"; shift ;;
    *) shift ;;
  esac
done
printf '%s\n' "$url" >>"$CURL_LOG"
if [ -n "\${CURL_DELAY:-}" ]; then
  sleep "$CURL_DELAY"
fi
cp "$TEST_ARCHIVE" "$output"
`, { mode: 0o755 });
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    NPM_PORTS_CACHE_DIR: cache,
    TEST_ARCHIVE: archive,
    CURL_LOG: curlLog,
    ROOT: root,
    SOURCE_SHA256: sha256,
    RUNTIME: runtime,
  };
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, archive, cache, curlLog, sha256, env };
}

function script(env, commands) {
  return execFileSync('bash', ['-c', `set -euo pipefail\nsource "$RUNTIME"\n${commands}`], { env, encoding: 'utf8' });
}

test('downloads are cached by digest and extraction cleans its destination', (t) => {
  const { root, cache, curlLog, env } = fixture(t);
  script(env, `
source=https://example.invalid/source.tgz
sha256="$SOURCE_SHA256"
resource upstream https://example.invalid/resource.tgz "$SOURCE_SHA256"
fetch_source "$ROOT/first.tgz"
fetch_resource upstream "$ROOT/second.tgz"
extract_source "$ROOT/extracted"
printf 'stale\n' >"$ROOT/extracted/stale.txt"
extract_source "$ROOT/extracted"
extract_resource upstream "$ROOT/flat" --strip-components=0
extract_source "$ROOT/filtered" -- --exclude='package/excluded.txt'
`);
  assert.equal(readFileSync(curlLog, 'utf8').trim().split('\n').length, 1);
  assert.equal(readFileSync(join(root, 'first.tgz'), 'utf8'), readFileSync(join(root, 'second.tgz'), 'utf8'));
  assert.equal(readFileSync(join(root, 'extracted', 'content.txt'), 'utf8'), 'payload\n');
  assert.equal(existsSync(join(root, 'extracted', 'stale.txt')), false);
  assert.equal(existsSync(join(root, 'flat', 'package', 'content.txt')), true);
  assert.equal(existsSync(join(root, 'filtered', 'content.txt')), true);
  assert.equal(existsSync(join(root, 'filtered', 'excluded.txt')), false);
  writeFileSync(join(cache, 'downloads', env.SOURCE_SHA256), 'corrupted\n');
  script(env, 'source=https://example.invalid/source.tgz\nsha256="$SOURCE_SHA256"\nfetch_source "$ROOT/third.tgz"');
  assert.equal(readFileSync(curlLog, 'utf8').trim().split('\n').length, 2);
  assert.equal(readFileSync(join(root, 'third.tgz'), 'utf8'), readFileSync(join(root, 'first.tgz'), 'utf8'));
});

test('concurrent downloads leave one valid cache object and complete outputs', async (t) => {
  const { root, cache, sha256, env } = fixture(t);
  const commands = `
source=https://example.invalid/source.tgz
sha256="$SOURCE_SHA256"
fetch_source "$ROOT/output.tgz"
`;
  const pending = Promise.all(Array.from({ length: 4 }, (_, index) => execute('bash', ['-c', `set -euo pipefail\nsource "$RUNTIME"\n${commands}`], {
    env: { ...env, CURL_DELAY: String((index + 1) / 10) },
  })));
  const cacheFile = join(cache, 'downloads', sha256);
  for (let attempt = 0; attempt < 100 && !existsSync(cacheFile); attempt++) await delay(5);
  assert.ok(existsSync(cacheFile));
  const inode = statSync(cacheFile).ino;
  await pending;
  assert.equal(readFileSync(cacheFile, 'utf8'), readFileSync(join(root, 'archive.tgz'), 'utf8'));
  assert.equal(statSync(cacheFile).ino, inode);
  assert.equal(readFileSync(join(root, 'output.tgz'), 'utf8'), readFileSync(join(root, 'archive.tgz'), 'utf8'));
  assert.deepEqual(readdirSync(join(cache, 'downloads')), [sha256]);
  assert.equal(readdirSync(root).some(name => name.startsWith('output.tgz.tmp.')), false);
});

test('a digest mismatch does not poison the cache and unsafe destinations are rejected', (t) => {
  const { root, cache, env } = fixture(t);
  assert.throws(() => script(env, `
source=https://example.invalid/source.tgz
sha256="$(printf '%064d' 0)"
fetch_source "$ROOT/output.tgz"
`), /WARNING: computed checksum did NOT match|WARNING: 1 computed checksum did NOT match/);
  assert.equal(existsSync(join(cache, 'downloads', '0'.repeat(64))), false);
  assert.equal(readdirSync(join(cache, 'downloads')).length, 0);
  assert.throws(() => script(env, `
source=https://example.invalid/source.tgz
sha256="$SOURCE_SHA256"
extract_source /
`), /Unsafe extraction destination/);
  assert.equal(existsSync(join(root, 'output.tgz')), false);
});
