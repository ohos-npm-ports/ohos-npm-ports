import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packPort } from './build.mjs';
import { closure, testSpec } from './consumer-test.mjs';

const consumerRunner = fileURLToPath(new URL('./run-port-consumer.mjs', import.meta.url));
const fetchPublished = fileURLToPath(new URL('./fetch-published.mjs', import.meta.url));

export function testPort(root, port, { build = true } = {}) {
  if (!testSpec(port.relative, root)) throw new Error(`${port.relative}: no test.mjs declared`);
  if (build) packPort(root, port);
  const temporary = mkdtempSync(join(tmpdir(), 'npm-ports-test-'));
  try {
    for (const dir of closure([port.relative], root)) {
      const artifacts = join(root, dir, 'artifacts');
      if (dir !== port.relative && !existsSync(join(artifacts, 'manifest.json'))) {
        execFileSync(process.execPath, [fetchPublished, dir], { cwd: root, stdio: 'inherit' });
      }
      if (!existsSync(join(artifacts, 'manifest.json'))) throw new Error(`${dir}: artifacts are missing; run npm-ports pack first`);
      cpSync(artifacts, join(temporary, basename(dir)), { recursive: true });
    }
    const sourceSha = process.env.GITHUB_SHA ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    execFileSync(process.execPath, [consumerRunner, temporary], {
      cwd: root,
      env: {
        ...process.env,
        NPM_PORTS_ROOT: root,
        CONSUMER_PORT: port.relative,
        EXPECTED_PLATFORM: process.platform,
        EXPECTED_ARCH: process.arch,
        GITHUB_SHA: sourceSha,
      },
      stdio: 'inherit',
    });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
