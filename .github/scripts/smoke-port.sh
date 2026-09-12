#!/bin/sh
# Post-build smoke check for one port (tap's "brew test must run the real
# binary, not just assert a file exists" principle, ported): confirms the
# npm package actually installs and its entry point actually loads —
# `.node` addons included, since a broken dlopen only shows up here, not
# at `build.sh`'s compile step.
#
# Assumes build.sh has already produced the package directory (this is a
# separate CI step run right after Build, not a rebuild) and that cwd is
# the repository root. Must stay POSIX sh: the ci-runner container has no
# bash (see docs/zh-CN/contributor/contributing.md).
#
# This exists as its own gate — not folded into build.sh, and not merged
# with the autobump pipeline's ../scripts/validate-port.sh (which does its
# own build+smoke for pre-merge PR validation against the upstream fork) —
# so this PR's diff to ci.yml stays a small, reviewable addition instead of
# rewiring the existing Build step. Many ports already self-verify at the
# end of their own build.sh (readelf/.codesign checks, functional dlopen
# probes, slot-name require — see verification.md); this is the fallback
# for ports that don't, so nothing ships with zero load-time verification.
#
# Usage: smoke-port.sh <port> <version>
set -eu

PORT="${1:?usage: smoke-port.sh <port> <version>}"
VER="${2:?}"
DIR="ports/$PORT/$VER"

[ -d "$DIR" ] || { echo "error: $DIR not found" >&2; exit 1; }
[ -f "$DIR/publish.sh" ] || { echo "error: $DIR/publish.sh not found" >&2; exit 1; }

ROOT="$PWD"
cd "$DIR"

# Locate the built package directory the same way publish.sh does: its
# first `cd <dir>` line names where the packable package.json lives.
PKGDIR=$(sed -n 's/^cd //p' publish.sh | head -1)
[ -n "$PKGDIR" ] || { echo "error: cannot parse build dir from publish.sh 'cd' line" >&2; exit 1; }
[ -d "$PKGDIR" ] || { echo "error: build dir '$PKGDIR' does not exist — did the Build step run first?" >&2; exit 1; }

PORTDIR="$PWD"
cd "$PKGDIR"

# Optional per-port override: smoke.sh next to build.sh, cwd = product dir.
if [ -f "$PORTDIR/smoke.sh" ]; then
  echo "== smoke ($PORT $VER): running per-port smoke.sh =="
  "$PORTDIR/smoke.sh"
  echo "== smoke ok (per-port smoke.sh): $PORT $VER =="
  cd "$ROOT"
  exit 0
fi

echo "== smoke ($PORT $VER): default npm-pack-install-require =="
# --ignore-scripts on both pack and install: smoke verifies the artifact
# build.sh already produced loads correctly, it must never trigger a
# lifecycle script (prepack/install) that rebuilds a native addon — caught
# for real against datadog-pprof, whose prepack re-invokes node-gyp and
# fails outside build.sh's own shell session (no llvm/clang on PATH there).
TGZ=$(npm pack --silent --ignore-scripts | tail -1)
[ -f "$TGZ" ] || { echo "error: npm pack produced nothing" >&2; exit 1; }
TGZ="$PWD/$TGZ"
# Clean up the packed tgz on every exit path, not just the happy one — a
# failed smoke otherwise leaves a stray .tgz sitting in the product dir.
# TGZ is captured as an absolute path since cwd changes (back to $ROOT)
# before this trap can fire.
trap 'rm -f "$TGZ"' EXIT

SCRATCH=$(mktemp -d)
(
  cd "$SCRATCH" || exit 1
  npm init -y >/dev/null
  npm install --no-audit --no-fund --ignore-scripts "$TGZ" >/dev/null

  # Find the one top-level package install put in place (skip dotfiles;
  # descend one level for a scoped @ohos-npm-ports/... package).
  NAME=$(node -e '
    const fs = require("fs");
    const mods = [];
    for (const d of fs.readdirSync("node_modules", { withFileTypes: true })) {
      if (!d.isDirectory() || d.name.startsWith(".")) continue;
      if (d.name.startsWith("@")) {
        for (const n of fs.readdirSync("node_modules/" + d.name, { withFileTypes: true })) {
          if (n.isDirectory()) mods.push(d.name + "/" + n.name);
        }
      } else mods.push(d.name);
    }
    console.log(mods.join("\n"));' | head -1)
  [ -n "$NAME" ] || { echo "error: nothing installed into node_modules" >&2; exit 1; }

  HAS_ENTRY=$(node -e '
    const p = require("./node_modules/" + process.argv[1] + "/package.json");
    console.log(p.main || p.exports ? "yes" : "no");' "$NAME")
  if [ "$HAS_ENTRY" = "yes" ]; then
    node -e "require(process.argv[1]); console.log('require ok: ' + process.argv[1])" "$NAME"
  else
    echo "no main/exports entry, install-only smoke"
  fi
) || { echo "error: smoke failed for $PORT $VER" >&2; rm -rf "$SCRATCH"; exit 1; }
rm -rf "$SCRATCH"

cd "$ROOT"
echo "== smoke ok: $PORT $VER =="
