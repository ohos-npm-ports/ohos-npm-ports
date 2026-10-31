import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const patterns = [
  ['new port', /^\S+: add port .+$/],
  ['revision bump', /^\S+: bump port revision to .+$/],
  ['version bump', /^\S+: bump (to|.+ to) .+$/],
  ['fix/enhancement', /^\S+: .+$/],
];

const withoutTrailingNewlines = (value) => value.replace(/\n+$/, '');

export function lintCommitMessages({
  base,
  head,
  summaryPath,
  exec = execFileSync,
  append = appendFileSync,
  log = console.log,
} = {}) {
  const git = (args) => withoutTrailingNewlines(exec('git', args, { encoding: 'utf8' }));
  const write = (text) => append(summaryPath, text);
  let failed = false;
  let checked = 0;

  write('### commit-message lint\n| commit | message | result |\n|---|---|---|\n');
  const commits = git(['log', '--format=%H', '--no-merges', `${base}..${head}`])
    .split('\n')
    .filter(Boolean);

  for (const sha of commits) {
    const touched = git(['diff-tree', '--no-commit-id', '--name-only', '-r', sha, '--', 'ports/']);
    if (!touched) continue;

    const message = git(['log', '-1', '--format=%s', sha]);
    const short = sha.slice(0, 7);
    const kind = patterns.find(([, pattern]) => pattern.test(message))?.[0];
    checked += 1;

    if (kind) {
      log(`-- ${short}: OK (${kind}) — ${message}`);
      write(`| \`${short}\` | \`${message}\` | ✅ ${kind} |\n`);
    } else {
      log(`::error::commit ${short} message does not match convention: "${message}"`);
      write(`| \`${short}\` | \`${message}\` | ❌ no match |\n`);
      failed = true;
    }
  }

  if (checked === 0) log('::notice::no commit in this PR touches ports/ — nothing to lint');

  if (failed) {
    write('\n**规范**（首行，仅适用于改动 `ports/**` 的 commit）：\n');
    write('- 新增 port：`<port>: add port <version>`\n');
    write('- 版本升级：`<port>: bump to <version> ...` / `<port>: bump port revision to <version>`\n');
    write('- 修复/整理：`<port>: <action>`\n');
    log("::error::one or more commit messages don't match the convention, see job summary");
    return 1;
  }

  write(`all commit messages OK (${checked} checked)\n`);
  return 0;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exitCode = lintCommitMessages({
    base: process.env.BASE,
    head: process.env.HEAD,
    summaryPath: process.env.GITHUB_STEP_SUMMARY,
  });
}
