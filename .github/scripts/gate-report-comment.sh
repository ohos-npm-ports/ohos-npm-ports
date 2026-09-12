#!/bin/bash
# Post a single upfront PR comment summarizing port-lint's findings, adapted
# from Harmonybrew tap's gate-report-comment.sh. Comment-only — never
# decides whether the PR can merge on its own; the actual required checks
# are port-lint.yml's job statuses. This just saves a contributor from
# digging through job logs to find out which port(s) failed and why.
#
# Env in: PR, REPO (gh pr comment target), CHANGED_JSON (JSON array of
# ports/<name>/<version> dirs), LINT_RESULT, COMMIT_RESULT ("success" or
# anything else).
set -uo pipefail

DIR_COUNT=$(jq -r 'length' <<< "$CHANGED_JSON")
DIR_LIST=$(jq -r 'join(", ")' <<< "$CHANGED_JSON")

lint_mark() { [ "$LINT_RESULT" = "success" ] && echo "✅" || echo "❌"; }
commit_mark() { [ "$COMMIT_RESULT" = "success" ] && echo "✅" || echo "❌"; }

if [ "$LINT_RESULT" = "success" ] && [ "$COMMIT_RESULT" = "success" ]; then
  VERDICT="静态检查通过，等待容器构建（\`ci.yml\`）。"
else
  VERDICT="静态检查未通过，见下方明细和各 job 日志。"
fi

COMMENT=$(cat <<EOF
## 🚪 port-lint 检查报告

> $VERDICT

| 检查项 | 结果 |
|--------|------|
| 改动的 port 目录（$DIR_COUNT 个） | $DIR_LIST |
| 目录形状 / patch 引用（\`port-lint\`） | $(lint_mark) |
| Commit message 格式（\`lint-commits\`） | $(commit_mark) |

不通过时具体是哪一条规则、哪个文件，见对应 job 的日志输出。
EOF
)

gh pr comment "$PR" --repo "$REPO" --body "$COMMENT" \
  || echo "::warning::failed to post gate-report comment (non-fatal)"
