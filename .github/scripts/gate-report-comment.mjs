import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function buildComment({ changed, lintResult, commitResult }) {
  const lintMark = lintResult === 'success' ? '✅' : '❌';
  const commitMark = commitResult === 'success' ? '✅' : '❌';
  const verdict = lintResult === 'success' && commitResult === 'success'
    ? '静态检查通过，等待容器构建（`ci.yml`）。'
    : '静态检查未通过，见下方明细和各 job 日志。';
  return `## 🚪 port-lint 检查报告

> ${verdict}

| 检查项 | 结果 |
|--------|------|
| 改动的 port 目录（${changed.length} 个） | ${changed.join(', ')} |
| 目录形状 / patch 引用（\`port-lint\`） | ${lintMark} |
| Commit message 格式（\`lint-commits\`） | ${commitMark} |

不通过时具体是哪一条规则、哪个文件，见对应 job 的日志输出。`;
}

export function main({ env = process.env, run = execFileSync } = {}) {
  const comment = buildComment({
    changed: JSON.parse(env.CHANGED_JSON),
    lintResult: env.LINT_RESULT,
    commitResult: env.COMMIT_RESULT,
  });
  try {
    run('gh', ['pr', 'comment', env.PR, '--repo', env.REPO, '--body', comment], { stdio: 'inherit' });
  } catch {
    console.log('::warning::failed to post gate-report comment (non-fatal)');
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main();
