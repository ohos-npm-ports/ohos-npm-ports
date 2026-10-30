import { execFileSync } from 'node:child_process';
import { bumpPorts } from './bump.mjs';

function run(command, args, cwd) {
  try {
    return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.stdout?.toString().trim() || error.message;
    throw new Error(`${command} ${args.join(' ')} failed: ${detail}`);
  }
}

function gitConfig(root, key, fallback, execute) {
  try { return execute('git', ['config', key], root) || fallback; }
  catch { return fallback; }
}

function openPortPrs(gh, repository, base, port) {
  const output = gh(
    'pr', 'list', '--repo', repository, '--base', base, '--state', 'open', '--limit', '1000',
    '--json', 'number,title,url,files',
  );
  const pullRequests = JSON.parse(output || '[]');
  return pullRequests.filter((pr) => (pr.files ?? []).some((file) => (
    file.path === port.relative || file.path.startsWith(`${port.relative}/`)
  )));
}

export async function bumpPr(root, port, {
  draft = true,
  base = 'main',
  execute = run,
  bump = bumpPorts,
} = {}) {
  const git = (...args) => execute('git', args, root);
  const gh = (...args) => execute('gh', args, root);
  const top = git('rev-parse', '--show-toplevel');
  if (top !== root) throw new Error(`Run bump-pr from the repository root: ${top}`);
  if (git('status', '--porcelain')) throw new Error('bump-pr requires a clean worktree');
  if (!/^[A-Za-z0-9._-]+$/.test(base)) throw new Error(`Invalid base branch: ${base}`);
  gh('--version');
  gh('auth', 'status');
  git('fetch', 'origin', base);
  if (git('rev-parse', 'HEAD') !== git('rev-parse', `origin/${base}`)) {
    throw new Error(`HEAD must exactly match origin/${base}; unrelated commits are not allowed`);
  }
  const repository = gh('repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner');
  const existing = openPortPrs(gh, repository, base, port);
  if (existing.length > 0) {
    const [pr] = existing;
    console.log(`${port.name}: skipping bump; open PR #${pr.number} already changes this port: ${pr.url}`);
    return { skipped: true, number: String(pr.number), url: pr.url };
  }
  const changed = await bump(root, [port], { write: true });
  if (changed.length === 0) {
    console.log(`${port.name}: no update; no branch or PR created`);
    return null;
  }
  if (changed.length !== 1) throw new Error('bump-pr accepts exactly one port');
  const { version } = changed[0];
  const branch = `automation/bump-${port.name}-${version}`.replace(/[^A-Za-z0-9._/-]/g, '-');
  if (git('branch', '--list', branch)) throw new Error(`Local branch already exists: ${branch}`);
  git('switch', '-c', branch);
  git('add', '--', port.relative);
  if (!git('diff', '--cached', '--name-only')) throw new Error('bump produced no tracked changes');
  const name = process.env.NPM_PORTS_GIT_NAME || gitConfig(root, 'user.name', 'github-actions[bot]', execute);
  const email = process.env.NPM_PORTS_GIT_EMAIL || gitConfig(root, 'user.email', '41898282+github-actions[bot]@users.noreply.github.com', execute);
  const title = `${port.name}: bump to ${version}`;
  git('-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-m', title);
  if (openPortPrs(gh, repository, base, port).length > 0) {
    throw new Error(`${port.name}: an open PR appeared during bump; refusing to push a competing branch`);
  }
  git('push', '-u', 'origin', `HEAD:refs/heads/${branch}`);
  const body = `Automated NPMBUILD upstream bump.\n\n- ${port.name}: ${port.version} → ${version}-1\n\nCI runs automatically for ordinary PRs. Draft PRs start CI when marked ready for review. Patch context and upstream build changes still require maintainer review.`;
  const args = ['pr', 'create', '--repo', repository, '--base', base, '--head', branch, '--title', title, '--body', body];
  if (draft) args.push('--draft');
  gh(...args);
  const number = gh('pr', 'list', '--repo', repository, '--head', branch, '--state', 'open', '--json', 'number', '--jq', '.[0].number');
  const url = gh('pr', 'view', number, '--repo', repository, '--json', 'url', '--jq', '.url');
  console.log(`${draft ? 'Draft PR' : 'PR'} created: ${url}`);
  return { skipped: false, url, number, branch, version };
}
