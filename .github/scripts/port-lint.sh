#!/bin/bash
# Static shape checks for one or more ports/<name>/<version>/ directories.
# Host-side (ubuntu-latest, no container needed) — fast enough to run on
# every push/PR before the expensive container build. Rules below were
# derived empirically: every rule marked BLOCKING was verified to pass
# cleanly against all port directories in this repo before being made
# blocking (see docs/zh-CN/contributor/port-spec.md "校验规则来源").
#
# Usage:
#   port-lint.sh                  # lint every ports/*/*/ directory
#   port-lint.sh ports/foo/1.2.3  # lint just this one
#
# Exit status: 0 if no BLOCKING finding fired in any linted directory.
# WARNING findings never affect the exit status.
set -uo pipefail

FAIL=0
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"

# grep alternation (`a\|b`) is unreliable in some shells/toolchains this
# project's containers touch — every multi-pattern grep below uses -E.

lint_one() {
  local dir="$1"
  local build="$dir/build.sh"
  local publish="$dir/publish.sh"
  local patchdir="$dir/patchs"
  local ok=1

  echo "== $dir =="

  # --- BLOCKING: build.sh / publish.sh must exist and parse as shell ---
  if [ ! -f "$build" ]; then
    echo "❌ missing build.sh"
    echo "| \`$dir\` | ❌ | missing build.sh |" >> "$SUMMARY"
    FAIL=1
    return
  fi
  if [ ! -f "$publish" ]; then
    echo "❌ missing publish.sh"
    echo "| \`$dir\` | ❌ | missing publish.sh |" >> "$SUMMARY"
    FAIL=1
    return
  fi

  local synerr
  synerr=$(sh -n "$build" 2>&1) || { echo "❌ build.sh: $synerr"; ok=0; }
  synerr=$(sh -n "$publish" 2>&1) || { echo "❌ publish.sh: $synerr"; ok=0; }

  # --- BLOCKING: build.sh must never itself run `npm publish` ---
  # (excluding comment-only lines — a line whose first non-space char is #)
  local pub_hit
  pub_hit=$(grep -nE 'npm publish' "$build" 2>/dev/null | grep -vE '^[0-9]+: *#')
  if [ -n "$pub_hit" ]; then
    echo "❌ build.sh invokes npm publish directly (that's publish.sh's job):"
    echo "$pub_hit"
    ok=0
  fi

  # --- BLOCKING: every patchs/*.patch must be applied by build.sh ---
  # Either build.sh applies patches by literal basename, or it loops over
  # a patchs/*.patch (or patchs/*) glob — either counts as "referenced".
  if [ -d "$patchdir" ]; then
    if ! grep -qE '(patchs/\*\.patch|patchs/\*[^.])' "$build" 2>/dev/null; then
      for p in "$patchdir"/*.patch; do
        [ -f "$p" ] || continue
        base=$(basename "$p")
        if ! grep -qF "$base" "$build"; then
          echo "❌ patchs/$base is never applied by build.sh"
          ok=0
        fi
      done
    fi
  fi

  # --- BLOCKING: package must publish under the @ohos-npm-ports/ scope ---
  # Loose but reliable: the scope string must appear somewhere the port's
  # own files construct the published package (build.sh, publish.sh, any
  # patch, or a static package.json checked into the port dir — all three
  # patterns exist in this repo, see port-spec.md).
  if ! grep -rqF "@ohos-npm-ports/" "$build" "$publish" "$patchdir" "$dir/package.json" 2>/dev/null; then
    echo "❌ no @ohos-npm-ports/ scope reference found anywhere in $dir"
    ok=0
  fi

  # --- WARNING: directory version should appear literally in build.sh ---
  # (or a static package.json) — catches "bumped the folder, forgot the
  # string inside" without trying to fully parse every packaging style.
  local ver
  ver=$(basename "$dir")
  if ! grep -qE "(^|[^0-9.])${ver//./\\.}([^0-9]|$)" "$build" "$dir/package.json" 2>/dev/null; then
    echo "⚠️  version string '$ver' not found literally in build.sh (check it wasn't left stale)"
  fi

  # --- WARNING: build.sh should self-verify its own output ---
  # (tap's "brew test must run the real binary" principle, port-side).
  # Advisory only for now — see verification.md for the target shape and
  # the known pre-existing gaps this doesn't yet block on.
  if ! grep -qE 'grep -q|node -e|node --check|readelf' "$build"; then
    echo "⚠️  build.sh has no visible self-verification (grep -q / node -e / readelf); see docs/zh-CN/contributor/verification.md"
  fi

  if [ "$ok" = 1 ]; then
    echo "✅ shape checks passed"
    echo "| \`$dir\` | ✅ | |" >> "$SUMMARY"
  else
    echo "| \`$dir\` | ❌ | see job log |" >> "$SUMMARY"
    FAIL=1
  fi
  echo
}

{
  echo "### port-lint"
  echo "| port | 结果 | 备注 |"
  echo "|---|---|---|"
} >> "$SUMMARY"

if [ "$#" -gt 0 ]; then
  for d in "$@"; do
    lint_one "${d%/}"
  done
else
  for d in ports/*/*/; do
    lint_one "${d%/}"
  done
fi

exit "$FAIL"
