import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, test } from 'node:test';

const script = resolve('.github/scripts/lint-commit-messages.mjs');
const temporary = [];
afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function makeRepo() {
  const directory = mkdtempSync(join(tmpdir(), 'commit-lint-'));
  temporary.push(directory);
  const git = (args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '-q']);
  git(['config', 'user.name', 'Test User']);
  git(['config', 'user.email', 'test@example.com']);
  writeFileSync(join(directory, 'README.md'), 'base\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'chore: base']);
  const base = git(['rev-parse', 'HEAD']);
  const commit = (file, contents, message) => {
    mkdirSync(dirname(join(directory, file)), { recursive: true });
    writeFileSync(join(directory, file), contents);
    git(['add', '-A']);
    git(['commit', '-q', '-m', message]);
    return git(['rev-parse', 'HEAD']);
  };
  const run = (head) => {
    const summary = join(directory, 'summary.md');
    const result = spawnSync(process.execPath, [script], {
      cwd: directory,
      env: { ...process.env, BASE: base, HEAD: head, GITHUB_STEP_SUMMARY: summary },
      encoding: 'utf8',
    });
    return { result, summary: readFileSync(summary, 'utf8') };
  };
  return { commit, run };
}

test('accepts a conventional port commit', () => {
  const repo = makeRepo();
  const head = repo.commit('ports/d/demo/NPMBUILD', 'demo\n', 'demo: add port 1.0.0');
  const { result, summary } = repo.run(head);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(summary, /new port/);
  assert.match(summary, /all commit messages OK \(1 checked\)/);
});

test('rejects an invalid port commit message', () => {
  const repo = makeRepo();
  const head = repo.commit('ports/d/demo/NPMBUILD', 'demo\n', 'update implementation');
  const { result, summary } = repo.run(head);
  assert.equal(result.status, 1);
  assert.match(summary, /no match/);
  assert.match(result.stdout, /does not match convention/);
});

test('ignores commits that do not touch ports', () => {
  const repo = makeRepo();
  const head = repo.commit('README.md', 'updated\n', 'docs: update');
  const { result, summary } = repo.run(head);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(summary, /all commit messages OK \(0 checked\)/);
  assert.match(result.stdout, /nothing to lint/);
});
