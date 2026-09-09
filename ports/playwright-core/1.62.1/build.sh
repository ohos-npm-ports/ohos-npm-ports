#!/bin/sh
set -e

# Builds the @ohos-npm-ports/playwright-core artifact: downloads the
# upstream playwright source, applies the HarmonyOS patches in ./patchs/,
# rebuilds the core web bundles and repackages under our scope. The source
# tree keeps the upstream package version (npm ci must match the workspace
# lockfile); the packaged artifact gets a `-1` revision suffix, same as this
# repo's other ports (lightningcss, typescript, ...), so a future patch
# revision can still be published without bumping the upstream version.

UPSTREAM_VERSION=1.62.1
VERSION="$UPSTREAM_VERSION-2"

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"

SOURCE="playwright-$UPSTREAM_VERSION"
ARTIFACT="playwright-core-$VERSION"
LIGHTNINGCSS_SPEC="@ohos-npm-ports/lightningcss@1.33.0-1"

# --- stage 1: fetch and patch the upstream source ---

echo "==> downloading playwright $UPSTREAM_VERSION source"
curl -fsSL --retry 5 --retry-delay 2 \
  "https://github.com/microsoft/playwright/archive/refs/tags/v${UPSTREAM_VERSION}.tar.gz" \
  -o "$SOURCE.tar.gz"
rm -rf "$SOURCE"
tar -zxf "$SOURCE.tar.gz"
rm "$SOURCE.tar.gz"
cd "$SOURCE"

echo "==> applying patches"
for patch in ../patchs/*.patch; do
  echo "patch -p1 < $(basename "$patch")"
  patch -p1 < "$patch"
done

# toybox patch on a malformed/renumbered hunk can silently no-op (exit 0,
# nothing changed) instead of failing — verify a marker from each patch
# actually landed rather than trusting the exit code alone.
echo "==> verifying patch markers"
test -f packages/playwright-core/src/ohos/launcher.ts
grep -q 'harmonyBundleName' packages/protocol/spec/mixins.yml
grep -q "isOpenHarmony() ? resolveCommandPath('ffmpeg')" packages/playwright-core/src/server/registry/index.ts

# --- stage 2: install dependencies and build playwright-core ---

# The browser downloader and electron binary download are irrelevant for the
# playwright-core build and do not work on openharmony; skip them.
echo "==> installing build dependencies"
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 PLAYWRIGHT_SKIP_BROWSER_GC=1 \
  ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --no-audit --no-fund

# The web-bundle build (vite:css-post) dlopens lightningcss' native binding,
# which has no openharmony flavor upstream. The upstream lock pins a single
# hoisted lightningcss@1.32.0, so every consumer (vite included) resolves it
# through node_modules/lightningcss — overwrite that one spot with our port
# instead of fighting npm semantics with aliases or overrides. `npm pack`
# (rather than a hand-built registry URL) tracks npm's own tarball naming.
echo "==> swapping in $LIGHTNINGCSS_SPEC"
LIGHTNINGCSS_TARBALL=$(npm pack "$LIGHTNINGCSS_SPEC" --silent)
rm -rf node_modules/lightningcss
mkdir node_modules/lightningcss
tar -zxf "$LIGHTNINGCSS_TARBALL" -C node_modules/lightningcss --strip-components=1
rm "$LIGHTNINGCSS_TARBALL"
node -e '
  const { transform } = require("lightningcss");
  const out = transform({ filename: "a.css", code: Buffer.from(".a{color:red}"), minify: true });
  console.log("lightningcss transform OK:", JSON.stringify(out.code.toString().trim()));
'

# packages/protocol/spec/mixins.yml (patched to add the harmony* launch
# options) must be regenerated into packages/protocol/src/channels.d.ts and
# the runtime validator before the esbuild steps bundle them into
# lib/coreBundle.js. Exit code 1 means it rewrote files, which is expected
# on a fresh clone; anything else is a real failure.
echo "==> regenerating the protocol channels"
node utils/generate_channels.js || [ $? -eq 1 ]

# npm_package_version feeds the trace-viewer version stamp; npm sets it for
# `npm run` builds, and running build.js directly must provide it. This is
# the upstream version, not our packaging revision: trace files this build
# produces are format-compatible with upstream playwright-core 1.62.1.
echo "==> building playwright-core"
npm_package_version="$UPSTREAM_VERSION" node utils/build/build.js

# --- stage 3: package and rename to @ohos-npm-ports/playwright-core ---

echo "==> packaging $ARTIFACT"
cd packages/playwright-core
npm pack --ignore-scripts > /dev/null
cd "$SCRIPT_DIR"
rm -rf "$ARTIFACT"
mkdir -p "$ARTIFACT"
tar -zxf "$SOURCE/packages/playwright-core/playwright-core-$UPSTREAM_VERSION.tgz" \
  -C "$ARTIFACT" --strip-components=1
rm "$SOURCE/packages/playwright-core/playwright-core-$UPSTREAM_VERSION.tgz"

# The source keeps the upstream name and version so `npm ci` stays in sync
# with the workspace lockfile; both are rewritten here on the packed
# artifact only. The revision suffix means a future patch fix can still be
# published without needing a new upstream playwright release.
node -e "
  const fs = require('fs');
  const path = '$ARTIFACT/package.json';
  const pkg = JSON.parse(fs.readFileSync(path, 'utf-8'));
  pkg.name = '@ohos-npm-ports/playwright-core';
  pkg.version = '$VERSION';
  fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
"

# --- verify package contents ---
(
  cd "$ARTIFACT"

  node --check index.js
  # ohos 入口的自包含相对 require 未被 esbuild 内联；exports 暴露 ./lib/ohos；
  # 版本号为 <上游版本>-1 修订号，与仓库其余 port 的版本约定一致
  grep -q 'require("../../index.js")' lib/ohos/index.js
  node -e '
    const pkg = require("./package.json");
    if (pkg.name !== "@ohos-npm-ports/playwright-core") throw new Error(`unexpected name: ${pkg.name}`);
    if (!pkg.exports["./lib/ohos"]) throw new Error("exports[./lib/ohos] missing");
    if (pkg.version !== "'"$VERSION"'") throw new Error(`unexpected version: ${pkg.version}`);
    if (pkg.version.replace(/-.*$/, "") !== "'"$UPSTREAM_VERSION"'") throw new Error(`version base != upstream: ${pkg.version}`);
    console.log("verify OK:", pkg.name, pkg.version);
  '

  # 发布产物应为纯 JS：不得混入任何需要签名的原生文件（ELF 魔数 7f 45 4c 46）
  ELFS=$(find . -type f -exec sh -c 'od -An -tx1 -N4 "$1" | grep -q "7f 45 4c 46"' _ {} \; -print)
  [ -z "$ELFS" ] || { echo "unexpected ELF files in artifact:" $ELFS >&2; exit 1; }

  # 真实功能冒烟测试：不止解析产物，实际 require 并跑通 API 入口——同仓
  # 其余 port 都有等价的功能验证，此前这个 port 只做了语法检查
  node -e '
    const pw = require("./index.js");
    for (const name of ["chromium", "firefox", "webkit"]) {
      if (typeof pw[name]?.launch !== "function") throw new Error(`playwright-core.${name}.launch missing`);
    }
    console.log("index.js smoke OK: chromium/firefox/webkit present");
  '
  node -e '
    const ohos = require("./lib/ohos");
    for (const name of ["HdcBackend", "launchViaHdc", "takeScreenshot", "resolveLaunchConfig"]) {
      if (!(name in ohos)) throw new Error(`lib/ohos export missing: ${name}`);
    }
    // A leftover bare require("playwright-core") would throw here in a
    // direct (non-aliased) @ohos-npm-ports install, since there is no
    // node_modules/playwright-core in that layout.
    if (typeof ohos.chromium?.launch !== "function") throw new Error("lib/ohos re-export of playwright-core is broken");
    console.log("lib/ohos smoke OK: HdcBackend/launchViaHdc/takeScreenshot present, playwright-core re-export resolves");
  '
)

echo "==> done: $ARTIFACT"
