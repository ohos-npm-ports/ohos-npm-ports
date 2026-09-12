#!/bin/bash
# autobump 阶段 1/3（宿主机 runner 上跑，bash 可用；容器内没有 bash，见 workflow 拆分注释）：
# 检测候选 → 改写新版本目录 → 在独立 worktree 提交并 push 分支 → 输出 validate matrix。
#
# 环境变量：
#   GITHUB_TOKEN      push 分支 + 查/开 PR（同仓 Actions token 权限足够，见 workflow 的
#                     permissions: contents: write / pull-requests: write）
#   ONLY_PORT         限单个 port 重跑
#   GITHUB_REPOSITORY 由 GitHub Actions 自动注入，无需单独配置
#   GITHUB_OUTPUT / GITHUB_STEP_SUMMARY
#
# 不做的事（分给后两个 job）：容器内构建冒烟（job 2）、开 PR（job 3）。
#
# 铁律：bump 分支基于 main 当前 tip（worktree，automation 文件不进分支 →
# PR diff 只含 ports/**）。
set -euo pipefail

: "${GITHUB_TOKEN:?GITHUB_TOKEN required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY required (set by GitHub Actions)}"
ONLY_PORT="${ONLY_PORT:-}"
API="https://api.github.com"
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"

UPSHA=$(git rev-parse HEAD)
echo "main = $UPSHA"

echo "== checking upstream versions =="
"$SCRIPTS_DIR/check-upstream-versions.sh" "$ONLY_PORT" > /tmp/versions.tsv || true
echo "--- versions report ---"
cat /tmp/versions.tsv

{
  echo "### versions @ $(date -u +%FT%TZ) (main ${UPSHA:0:7})"
  echo
  echo '```'
  cat /tmp/versions.tsv
  echo '```'
} >> "${GITHUB_STEP_SUMMARY:-/dev/null}"

# 候选：behind + allowlisted；major 跨越优先，其余按名字序
mapfile -t CANDIDATES < <(
  awk -F'\t' '$4 == "behind" && $5 == "true" {print $1 "\t" $2 "\t" $3}' /tmp/versions.tsv |
  awk -F'\t' -v OFS='\t' '{split($3, a, "."); split($2, b, "."); print (a[1] != b[1] ? 0 : 1), $0}' |
  sort -k1,1 -k2,2 | cut -f2-
)

if [ "${#CANDIDATES[@]}" -eq 0 ]; then
  echo "no allowlisted port is behind upstream" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
  echo 'matrix={"include":[]}' >> "${GITHUB_OUTPUT:-/dev/null}"
  exit 0
fi

pr_open_for_head() { # $1 = head (owner:branch)；输出 PR url 或空
  curl -fsS -H "Authorization: Bearer $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    "$API/repos/$GITHUB_REPOSITORY/pulls?head=$1&state=open" 2>/dev/null |
    jq -r '.[0].html_url // empty' || true
}

MAX_PRS=$(jq -r '.max_prs_per_run // 3' "$SCRIPTS_DIR/ports-index.json")
WT=/tmp/port-worktree
OPENED=0
declare -a LEGS=()
REPO_OWNER="${GITHUB_REPOSITORY%%/*}"

for line in "${CANDIDATES[@]}"; do
  IFS=$'\t' read -r PORT FROM TO <<< "$line"
  BRANCH="port/$PORT-$TO-1"
  echo "== $PORT: $FROM → $TO (branch $BRANCH) =="

  if [ "$OPENED" -ge "$MAX_PRS" ]; then
    echo "- ⏳ $PORT $TO: skipped, MAX_PRS_PER_RUN=$MAX_PRS reached (next run)" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
    continue
  fi

  # main 已出现该目录（人工已经手动加了）→ 跳过；已有同 head 的 open PR → 跳过
  if git cat-file -e "$UPSHA:ports/$PORT/$TO" 2>/dev/null; then
    echo "- ⏭️ $PORT $TO: main already has it" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
    continue
  fi
  if [ -n "$(pr_open_for_head "$REPO_OWNER:$BRANCH")" ]; then
    echo "- ⏭️ $PORT $TO: PR already open" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
    continue
  fi

  # 改写 + 独立 worktree 提交 + push（分支基于 main 当前 tip）
  git worktree remove --force "$WT" 2>/dev/null || true
  git worktree prune
  rm -rf "$WT"
  git worktree add --detach "$WT" "$UPSHA" >/dev/null 2>&1
  if ! ( cd "$WT" && "$SCRIPTS_DIR/bump-port.sh" "$PORT" "$FROM" "$TO" ); then
    echo "- ❌ $PORT $FROM → $TO: rewrite failed (residue?), see log" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
    continue
  fi
  if ! ( cd "$WT"
    git config user.name "autobump[bot]"
    git config user.email "autobump@users.noreply.github.com"
    git add "ports/$PORT/$TO"
    git commit -q -m "$PORT: add port $TO"
    git push -q origin "+HEAD:refs/heads/$BRANCH"
  ); then
    echo "- ❌ $PORT $TO: commit/push failed" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
    continue
  fi
  # push 后 ls-remote 复核（push 静默失败兜底，tap 教训）
  if ! git ls-remote --exit-code --heads origin "refs/heads/$BRANCH" >/dev/null 2>&1; then
    echo "- ❌ $PORT $TO: branch not pushed" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
    continue
  fi

  echo "- ✅ $PORT $TO: branch pushed, queued for container validation" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
  # port 目录 tar 给 job 2（容器）展开验证；-C WT 保证 tar 内路径即仓库相对路径
  tar -cf "${GITHUB_WORKSPACE:-/tmp}/port-dir-$PORT.tar" -C "$WT" "ports/$PORT/$TO"
  LEGS+=("{\"port\":\"$PORT\",\"from\":\"$FROM\",\"to\":\"$TO\",\"branch\":\"$BRANCH\"}")
  OPENED=$((OPENED + 1))
  git worktree remove --force "$WT" 2>/dev/null || true
done

MATRIX=$(printf '{"include":[%s]}' "$(IFS=,; echo "${LEGS[*]:-}")")
# 多行输出用 heredoc 定界符语法，防止 matrix 内容被截断
{
  echo 'matrix<<MATRIX_JSON_EOF'
  echo "$MATRIX"
  echo 'MATRIX_JSON_EOF'
} >> "${GITHUB_OUTPUT:-/dev/null}"
echo "matrix = $MATRIX"
