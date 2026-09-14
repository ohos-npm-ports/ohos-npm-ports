#!/bin/sh
# Post-build smoke check for one port: pack the built artifact, install it in
# a clean project, and load its declared entry point.
# Assumes build.sh has already produced the package directory (this is a
# separate CI step run right after Build, not a rebuild) and that cwd is
# the repository root. Must stay POSIX sh.
#
# This check is separate from build.sh so it can validate the packed artifact
# without changing the existing build or publish steps.
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
# first `cd <dir>` line names where the packable package.json lives. This
# is eval'd, not treated as literal text — a platform-slot package's cd
# target can be an expression like `cd "$(dirname "$0")/<pkg>-<ver>"`
# (parcel-watcher-openharmony-arm64 precedent), not just a plain path; $0
# is bound to publish.sh's own path to match what it sees when actually
# run. PKGDIR ends up absolute.
CDLINE=$(sed -n 's/^cd //p' publish.sh | head -1)
[ -n "$CDLINE" ] || { echo "error: cannot parse build dir from publish.sh 'cd' line" >&2; exit 1; }
PKGDIR=$(sh -c "cd $CDLINE >/dev/null 2>&1 && pwd" './publish.sh' 2>/dev/null)
[ -n "$PKGDIR" ] && [ -d "$PKGDIR" ] || { echo "error: build dir from 'cd $CDLINE' does not exist — did the Build step run first?" >&2; exit 1; }

PORTDIR="$PWD"
cd "$PKGDIR"
PKG_NAME=$(node -p 'require("./package.json").name')

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

  # Use the package name from the artifact rather than whichever dependency
  # npm happened to place first in node_modules.
  NAME="$PKG_NAME"
  [ -f "node_modules/$NAME/package.json" ] || { echo "error: target package was not installed: $NAME" >&2; exit 1; }

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
