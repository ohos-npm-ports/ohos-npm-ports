#!/bin/bash
# Validate each human commit in $BASE..$HEAD that touches ports/** against
# this repo's de-facto commit convention (adapted from Harmonybrew's tap
# lint-commit-messages.sh). Commits that don't touch ports/ (a README
# update, a CI workflow tweak) are out of scope entirely, not just exempt —
# this repo has never enforced one-port-one-commit-per-PR, so mixing a
# port change with an unrelated doc/CI commit in one PR is normal here.
#
# The convention below is reverse-engineered from this repo's own history
# (see docs/zh-CN/contributor/port-spec.md "commit 规范"): it converged
# organically on `<port>: <action> ...` once the repo settled past its
# early free-form/Chinese-only commits. Those older commits are never
# re-checked — this only ever looks at $BASE..$HEAD, i.e. the PR's own
# commits.
set -euo pipefail

# Shape shared by every accepted first line: a single token (no spaces —
# the port directory name, or the literal `ports` for a multi-port commit),
# a colon, a space, then a non-empty description. Sub-patterns below only
# exist to label the summary table; any of them already satisfies this one.
PORT_PREFIX_RE='^[^[:space:]]+: .+$'
NEW_PORT_RE='^[^[:space:]]+: add port .+$'
REVISION_RE='^[^[:space:]]+: bump port revision to .+$'
BUMP_RE='^[^[:space:]]+: bump (to|.+ to) .+$'

FAIL=0
CHECKED=0
{
  echo "### commit-message lint"
  echo "| commit | message | result |"
  echo "|---|---|---|"
} >> "$GITHUB_STEP_SUMMARY"

while IFS= read -r sha; do
  git diff-tree --no-commit-id --name-only -r "$sha" -- 'ports/' \
    | grep -q . || continue

  msg=$(git log -1 --format=%s "$sha")
  short="${sha:0:7}"
  CHECKED=$((CHECKED + 1))

  if [[ "$msg" =~ $NEW_PORT_RE ]]; then
    kind="new port"
  elif [[ "$msg" =~ $REVISION_RE ]]; then
    kind="revision bump"
  elif [[ "$msg" =~ $BUMP_RE ]]; then
    kind="version bump"
  elif [[ "$msg" =~ $PORT_PREFIX_RE ]]; then
    kind="fix/enhancement"
  else
    kind=""
  fi

  if [ -n "$kind" ]; then
    echo "-- $short: OK ($kind) — $msg"
    echo "| \`$short\` | \`$msg\` | ✅ $kind |" >> "$GITHUB_STEP_SUMMARY"
  else
    echo "::error::commit $short message does not match convention: \"$msg\""
    echo "| \`$short\` | \`$msg\` | ❌ no match |" >> "$GITHUB_STEP_SUMMARY"
    FAIL=1
  fi
done < <(git log --format=%H --no-merges "$BASE..$HEAD")

if [ "$CHECKED" -eq 0 ]; then
  echo "::notice::no commit in this PR touches ports/ — nothing to lint"
fi

if [ "$FAIL" -eq 1 ]; then
  cat >> "$GITHUB_STEP_SUMMARY" <<'EOF'

**规范**（首行，仅适用于改动 `ports/**` 的 commit）：
- 新增 port：`<port>: add port <version>`
- 版本升级：`<port>: bump to <version> ...` / `<port>: bump port revision to <version>`
- 修复/整理：`<port>: <action>`
EOF
  echo "::error::one or more commit messages don't match the convention, see job summary"
  exit 1
fi

echo "all commit messages OK ($CHECKED checked)" >> "$GITHUB_STEP_SUMMARY"
