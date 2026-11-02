import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const image = 'ghcr.io/ohos-npm-ports/ci-runner:latest';
const requestLabel = 'request-ai-bump';

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit' });
}

function output(command, args) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  }).trim();
}

function writeFile(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  rmSync(path, { force: true });
  writeFileSync(path, text);
}

function statePath(env = process.env) {
  if (!env.AI_BUMP_STATE) throw new Error('AI_BUMP_STATE is required');
  return env.AI_BUMP_STATE;
}

function reportDirectory(env = process.env) {
  if (!env.AI_BUMP_REPORT_DIR) throw new Error('AI_BUMP_REPORT_DIR is required');
  return env.AI_BUMP_REPORT_DIR;
}

function loadState(env = process.env) {
  return JSON.parse(readFileSync(statePath(env), 'utf8'));
}

function runUrl(env = process.env) {
  return `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
}

function clip(text, limit = 50000) {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n内容过长，完整信息见流水线日志。`;
}

function readIfPresent(path) {
  if (!existsSync(path)) return '';
  if (!lstatSync(path).isFile()) throw new Error(`Expected a regular file: ${path}`);
  return readFileSync(path, 'utf8').trim();
}

function reportBody(state, env = process.env) {
  const report = readIfPresent(`${reportDirectory(env)}/report.md`);
  return report || 'AI 未生成额外报告，根因和修复过程见流水线日志。';
}

export function singlePortDirectory(paths) {
  if (paths.length === 0) throw new Error('The PR has no changed files');
  const directories = new Set();
  for (const path of paths) {
    const match = /^ports\/[^/]+\/[^/]+\//.exec(path);
    if (!match) throw new Error(`AI bump only accepts changes inside one port: ${path}`);
    directories.add(match[0].slice(0, -1));
  }
  if (directories.size !== 1) throw new Error('AI bump requires exactly one changed port');
  return [...directories][0];
}

export function assertPortPaths(paths, portDirectory) {
  for (const path of paths) {
    if (!path.startsWith(`${portDirectory}/`)) {
      throw new Error(`AI changed a file outside ${portDirectory}: ${path}`);
    }
  }
}

export function assertTargetVersion(before, after) {
  if (before.version !== after.version) {
    throw new Error(`The repair changed the target version from ${before.version} to ${after.version}`);
  }
}

function declaredNewFiles(state, env) {
  const root = `${reportDirectory(env)}/new-files`;
  if (!existsSync(root)) return [];
  if (!lstatSync(root).isDirectory()) throw new Error('new-files must be a real directory');
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const source = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(source);
        continue;
      }
      if (!entry.isFile()) throw new Error(`New source files must be regular files: ${source}`);
      const path = relative(root, source);
      assertPortPaths([path], state.portDirectory);
      if (output('git', ['ls-files', '--', path])) {
        throw new Error(`A declared new file already exists in the PR: ${path}`);
      }
      const destination = resolve(env.GITHUB_WORKSPACE, path);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(source, destination);
      chmodSync(destination, lstatSync(source).mode);
      files.push(path);
    }
  };
  visit(root);
  return files.sort();
}

function restoreOwnership(env = process.env) {
  run('sudo', [
    'chown', '-R', `${process.getuid()}:${process.getgid()}`,
    env.GITHUB_WORKSPACE, reportDirectory(env),
  ]);
}

function dockerArguments(state, env = process.env, withKey = false) {
  const args = [
    'run', '--rm',
    '-v', `${env.GITHUB_WORKSPACE}:/workspace`,
    '-v', `${reportDirectory(env)}:/report`,
    '-w', '/workspace',
  ];
  if (withKey) args.push('-e', 'DEEPSEEK_API_KEY');
  return args;
}

function prepare(env = process.env) {
  for (const name of ['HAS_APP_ID', 'HAS_APP_PRIVATE_KEY', 'HAS_DEEPSEEK_API_KEY']) {
    if (env[name] !== 'true') throw new Error(`Required Actions secret is not configured: ${name.slice(4)}`);
  }
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const pr = event.pull_request;
  if (event.label?.name !== requestLabel) throw new Error(`Missing ${requestLabel} label`);
  if (pr.base.ref !== 'main') throw new Error('AI bump only accepts PRs targeting main');
  if (pr.head.repo?.full_name !== env.GITHUB_REPOSITORY) throw new Error('AI bump only accepts same-repository PRs');
  if (!pr.head.ref.startsWith('automation/bump-')) throw new Error('AI bump only accepts automated bump branches');
  if (pr.user.type !== 'Bot') throw new Error('AI bump only accepts bot-authored PRs');

  const permission = output('gh', [
    'api', `repos/${env.GITHUB_REPOSITORY}/collaborators/${encodeURIComponent(event.sender.login)}/permission`,
    '--jq', '.permission',
  ]);
  if (!['admin', 'maintain', 'write'].includes(permission)) {
    throw new Error(`The label actor does not have write permission: ${event.sender.login}`);
  }

  const details = JSON.parse(output('gh', [
    'pr', 'view', String(pr.number), '--repo', env.GITHUB_REPOSITORY,
    '--json', 'commits,files,headRefOid,headRefName,state',
  ]));
  if (details.state !== 'OPEN') throw new Error('The PR is not open');
  if (details.headRefOid !== pr.head.sha || details.headRefName !== pr.head.ref) {
    throw new Error('The PR changed after the label event; apply the label again');
  }
  if (details.commits.length !== 1) throw new Error('AI bump requires a PR with exactly one commit');

  const paths = details.files.map(({ path }) => path);
  const portDirectory = singlePortDirectory(paths);
  if (!paths.includes(`${portDirectory}/NPMBUILD`)) throw new Error('The PR does not change NPMBUILD');
  const port = JSON.parse(output('cli/npm-ports', ['info', portDirectory, '--json']));
  const state = {
    number: pr.number,
    title: pr.title,
    repository: env.GITHUB_REPOSITORY,
    headRef: pr.head.ref,
    headSha: pr.head.sha,
    portDirectory,
    port,
    runUrl: runUrl(env),
  };
  writeFile(statePath(env), `${JSON.stringify(state, null, 2)}\n`);
  appendFileSync(env.GITHUB_OUTPUT, `port=${portDirectory}\n`);
  run('gh', ['pr', 'edit', String(pr.number), '--repo', env.GITHUB_REPOSITORY, '--remove-label', requestLabel]);
  console.log(`Validated ${pr.title}; ${requestLabel} removed`);
}

function promptFor(state) {
  return `你需要修复一个 npm 包移植到 OpenHarmony 后的自动版本升级 PR。

仓库位于 /workspace，PR 标题：${state.title}
只允许修改 ${state.portDirectory}/ 内已有 Git 跟踪的源文件。若需要新增源文件，修复完成后必须按仓库相对路径把最终内容复制到 /report/new-files/，例如 /report/new-files/${state.portDirectory}/test.js 或 /report/new-files/${state.portDirectory}/ohos/helper.cjs。未按此声明的工作区新文件会作为构建产物清理。目标上游版本必须保持为 ${state.port.version}，不得通过降级、删除测试、跳过检查或屏蔽错误来制造成功。

先执行 npm-ports check ${state.portDirectory} 复现失败。查看 git diff HEAD^ HEAD 了解本次升级，检查现有补丁和构建参数，必要时对照上游同版本源码与变更。保留已有的 OpenHarmony 适配，不要修改其他 port、CLI、文档或工作流，不要执行 git commit 或 git push，不要读取或输出 DEEPSEEK_API_KEY。

修复后必须实际执行并通过：
npm-ports lint ${state.portDirectory}
npm-ports check ${state.portDirectory}

最后把简洁的中文报告写入 /report/report.md，从二级标题开始，按“现象”“根因”“修复”“验证”组织。只有真实命令通过后才能写验证成功。`;
}

function repair(env = process.env) {
  const state = loadState(env);
  const reports = reportDirectory(env);
  rmSync(reports, { recursive: true, force: true });
  mkdirSync(reports, { recursive: true });
  writeFile(`${reports}/prompt.txt`, promptFor(state));
  const script = `set -e
export PATH="/workspace/cli:$PATH"
brew install -y deepseek-harness
mkdir -p /root/.dsh
printf '%s\n' 'agent-default-model:' '  provider: deepseek-official' '  model: deepseek-flash' '  reasoningEffort: high' > /root/.dsh/settings.yaml
dsh --profile headless "$(cat /report/prompt.txt)"`;
  try {
    run('docker', [
      ...dockerArguments(state, env, true),
      image, 'sh', '-lc', script,
    ]);
  } finally {
    restoreOwnership(env);
  }
  const reportPath = `${reports}/report.md`;
  const report = readIfPresent(reportPath);
  if (report && env.DEEPSEEK_API_KEY) {
    writeFile(reportPath, report.split(env.DEEPSEEK_API_KEY).join('***'));
  }
}

export function stageRepair(state, env = process.env) {
  const tracked = output('git', ['diff', '--name-only', '-z', 'HEAD', '--']).split('\0').filter(Boolean);
  assertPortPaths(tracked, state.portDirectory);
  const candidates = [...tracked, ...declaredNewFiles(state, env)];
  if (candidates.length === 0) throw new Error('AI did not change tracked source files or declare new source files');
  run('git', ['add', '-A', '--', ...candidates]);
  run('git', ['clean', '-fdx', '--', state.portDirectory]);
  const staged = output('git', ['diff', '--cached', '--name-only', 'HEAD', '--']).split('\n').filter(Boolean);
  assertPortPaths(staged, state.portDirectory);
  run('git', ['diff', '--cached', '--check', 'HEAD', '--']);
}

function verify(env = process.env) {
  const state = loadState(env);
  if (output('git', ['rev-parse', 'HEAD']) !== state.headSha) {
    throw new Error('AI changed the checked-out commit instead of leaving working-tree changes');
  }
  const current = JSON.parse(output('cli/npm-ports', ['info', state.portDirectory, '--json']));
  assertTargetVersion(state.port, current);
  stageRepair(state, env);
  try {
    run('docker', [
      ...dockerArguments(state, env),
      image, 'sh', '-lc', 'export PATH="/workspace/cli:$PATH"\nnpm-ports lint "$1" && npm-ports check "$1"', 'sh', state.portDirectory,
    ]);
  } finally {
    restoreOwnership(env);
    run('git', ['clean', '-fdx', '--', state.portDirectory]);
  }
  if (output('git', ['diff', '--name-only'])) {
    throw new Error('The independent build modified tracked files after the repair was staged');
  }
  const patch = `${reportDirectory(env)}/repair.patch`;
  rmSync(patch, { force: true });
  assertPortPaths(output('git', ['diff', '--cached', '--name-only', 'HEAD', '--']).split('\n').filter(Boolean), state.portDirectory);
  run('git', ['diff', '--cached', '--binary', '--full-index', `--output=${patch}`, 'HEAD', '--', state.portDirectory]);
  writeFile(statePath(env), `${JSON.stringify({ ...state, verified: true, patch }, null, 2)}\n`);
}

function comment(state, body) {
  try {
    run('gh', ['pr', 'comment', String(state.number), '--repo', state.repository, '--body', clip(body)]);
  } catch {
    console.log('::warning::failed to post the AI bump comment');
  }
}

function publish(env = process.env) {
  const state = loadState(env);
  if (!state.verified || !existsSync(state.patch)) throw new Error('Refusing to push an unverified repair');
  const clone = `${dirname(statePath(env))}/ai-bump-publish`;
  rmSync(clone, { recursive: true, force: true });
  run('gh', ['auth', 'setup-git']);
  run('git', [
    'clone', '--depth', '2', '--branch', state.headRef,
    `https://github.com/${state.repository}.git`, clone,
  ]);
  if (output('git', ['-C', clone, 'rev-parse', 'HEAD']) !== state.headSha) {
    throw new Error('The PR source branch changed while AI was running; no repair was pushed');
  }
  run('git', ['-C', clone, 'apply', '--index', '--whitespace=error-all', state.patch]);
  run('git', [
    '-C', clone,
    '-c', 'user.name=github-actions[bot]',
    '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
    'commit', '--amend', '--no-edit',
  ]);
  run('git', [
    '-C', clone,
    'push', `--force-with-lease=refs/heads/${state.headRef}:${state.headSha}`,
    'origin', `HEAD:refs/heads/${state.headRef}`,
  ]);
  const sha = output('git', ['-C', clone, 'rev-parse', 'HEAD']);
  comment(state, `## AI 修复报告\n\n修复已 amend 到原提交并推送为 \`${sha.slice(0, 7)}\`，新的 CI 会自动运行。\n\n[查看 AI 修复流水线](${state.runUrl})\n\n${reportBody(state, env)}`);
  console.log(`Verified repair pushed as ${sha}`);
}

function finalize(env = process.env) {
  const reports = reportDirectory(env);
  const state = loadState(env);
  const error = readIfPresent(`${reports}/error.txt`);
  const report = readIfPresent(`${reports}/report.md`);
  const detail = [error && `错误：${error}`, report].filter(Boolean).join('\n\n');
  comment(state, `## AI 修复未完成\n\n[查看流水线日志](${state.runUrl})\n\n${detail || '请根据流水线日志定位失败原因。'}`);
}

const commands = { prepare, repair, verify, publish, finalize };

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    const command = commands[process.argv[2]];
    if (!command) throw new Error(`Usage: node .github/scripts/ai-bump.mjs <${Object.keys(commands).join('|')}>`);
    command();
  } catch (error) {
    console.error(`::error::${error.message}`);
    if (process.env.AI_BUMP_REPORT_DIR) {
      try { writeFile(`${reportDirectory()}/error.txt`, `${error.message}\n`); } catch { }
    }
    process.exitCode = 1;
  }
}
