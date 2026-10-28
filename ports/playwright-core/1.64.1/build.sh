#!/bin/sh
set -e

UPSTREAM_VERSION=1.64.1
VERSION="$UPSTREAM_VERSION-1"

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BUILD_DIR="$SCRIPT_DIR/build"
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

SOURCE="playwright-$UPSTREAM_VERSION"
ARTIFACT="playwright-core-$VERSION"
LIGHTNINGCSS_SPEC="@ohos-npm-ports/lightningcss@1.33.0-1"

do_fetch() {
  cd "$BUILD_DIR"
  echo "==> downloading playwright $UPSTREAM_VERSION source"
  curl -fsSL --retry 5 --retry-delay 2 \
    "https://codeload.github.com/microsoft/playwright/tar.gz/refs/tags/v${UPSTREAM_VERSION}" \
    -o "$SOURCE.tar.gz"
  echo "4cf21457cd00395c83b29e7f787b72e8b3bb00cee14728c69ac80a12ae42f089  $SOURCE.tar.gz" | sha256sum -c -
  rm -rf "$SOURCE"
  tar -zxf "$SOURCE.tar.gz"
  rm "$SOURCE.tar.gz"
  cd "$SOURCE"

}

do_build() {
  cd "$BUILD_DIR/$SOURCE"
  echo "==> applying patches"
  for patch in "$SCRIPT_DIR"/patchs/*.patch; do
    echo "patch -p1 < $(basename "$patch")"
    patch -p1 < "$patch"
  done

  echo "==> verifying patch markers"
  test -f packages/playwright-core/src/ohos/launcher.ts
  grep -q 'harmonyBundleName' packages/protocol/spec/mixins.yml
  grep -q "isOpenHarmony() ? resolveCommandPath('ffmpeg')" packages/playwright-core/src/server/registry/index.ts
  grep -q 'ohosExecutablePath' packages/playwright-core/src/server/chromium/chromium.ts
  grep -q 'browserProcess.onclose' packages/playwright-core/src/ohos/launcher.ts
  grep -q 'launchViaAa' packages/playwright-core/src/ohos/launcher.ts
  test ! -e packages/playwright-core/src/ohos/hdc.ts
  test ! -e packages/playwright-core/src/ohos/ohos-aa.ts
  grep -q "options.channel ?? 'chrome'" packages/playwright-core/src/ohos/launcher.ts

  echo "==> installing build dependencies"
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 PLAYWRIGHT_SKIP_BROWSER_GC=1 \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --no-audit --no-fund

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

  echo "==> regenerating the protocol channels"
  node utils/generate_channels.js || [ $? -eq 1 ]

  echo "==> building playwright-core"
  npm_package_version="$UPSTREAM_VERSION" node utils/build/build.js
  node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit

}

do_package() {
  cd "$BUILD_DIR/$SOURCE"
  echo "==> packaging $ARTIFACT"
  cd packages/playwright-core
  npm pack --ignore-scripts > /dev/null
  cd "$BUILD_DIR"
  rm -rf "$ARTIFACT"
  mkdir -p "$ARTIFACT"
  tar -zxf "$SOURCE/packages/playwright-core/playwright-core-$UPSTREAM_VERSION.tgz" \
    -C "$ARTIFACT" --strip-components=1
  rm "$SOURCE/packages/playwright-core/playwright-core-$UPSTREAM_VERSION.tgz"

  node -e "
    const fs = require('fs');
    const path = '$ARTIFACT/package.json';
    const pkg = JSON.parse(fs.readFileSync(path, 'utf-8'));
    pkg.name = '@ohos-npm-ports/playwright-core';
    pkg.version = '$VERSION';
    fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
  "

}

do_test() {
  (
    cd "$BUILD_DIR/$ARTIFACT"

    node --check index.js
    node "$SCRIPT_DIR/tests/aa-first.cjs" "$PWD/lib/ohos/launcher.js"
    node "$SCRIPT_DIR/tests/public-api.cjs" "$PWD"
    grep -q 'require("../../index.js")' lib/ohos/index.js
    node -e '
      const pkg = require("./package.json");
      if (pkg.name !== "@ohos-npm-ports/playwright-core") throw new Error(`unexpected name: ${pkg.name}`);
      if (!pkg.exports["./lib/ohos"]) throw new Error("exports[./lib/ohos] missing");
      if (pkg.version !== "'"$VERSION"'") throw new Error(`unexpected version: ${pkg.version}`);
      if (pkg.version.replace(/-.*$/, "") !== "'"$UPSTREAM_VERSION"'") throw new Error(`version base != upstream: ${pkg.version}`);
      console.log("verify OK:", pkg.name, pkg.version);
    '

    ELFS=$(find . -type f -exec sh -c 'od -An -tx1 -N4 "$1" | grep -q "7f 45 4c 46"' _ {} \; -print)
    [ -z "$ELFS" ] || { echo "unexpected ELF files in artifact:" $ELFS >&2; exit 1; }

    node -e '
      const pw = require("./index.js");
      for (const name of ["chromium", "firefox", "webkit"]) {
        if (typeof pw[name]?.launch !== "function") throw new Error(`playwright-core.${name}.launch missing`);
      }
      console.log("index.js smoke OK: chromium/firefox/webkit present");
    '
    node -e '
      const ohos = require("./lib/ohos");
      for (const name of ["launchViaAa", "takeScreenshot", "resolveLaunchConfig"]) {
        if (!(name in ohos)) throw new Error(`lib/ohos export missing: ${name}`);
      }
      // A leftover bare require("playwright-core") would throw here in a
      // direct (non-aliased) @ohos-npm-ports install, since there is no
      // node_modules/playwright-core in that layout.
      if (typeof ohos.chromium?.launch !== "function") throw new Error("lib/ohos re-export of playwright-core is broken");
      console.log("lib/ohos smoke OK: launchViaAa/takeScreenshot present, playwright-core re-export resolves");
    '

    grep -q 'ohosExecutablePath' lib/coreBundle.js
    grep -q 'startBrowserViaAa' lib/coreBundle.js
    grep -q '__ohosDeviceBrowser' lib/coreBundle.js
    node -e '
      if (process.platform !== "openharmony") process.exit(0);
      process.env.PATH = "";
      const { chromium } = require("./index.js");
      if (chromium.executablePath() !== "aa") throw new Error("executablePath must resolve local aa");
      console.log("local aa executablePath smoke OK");
    '
    node -e '
      const ohos = require("./lib/ohos");
      delete process.env.HARMONY_BROWSER;
      const def = ohos.resolveLaunchConfig({});
      if (def.bundleName !== "com.haitai.htbrowser") throw new Error(`default browser = ${def.bundleName}`);
      process.env.HARMONY_BROWSER = "huaweiBrowser";
      const huawei = ohos.resolveLaunchConfig({});
      if (huawei.bundleName !== "com.huawei.hmos.browser") throw new Error(`HARMONY_BROWSER override = ${huawei.bundleName}`);
      console.log("default browser smoke OK:", def.bundleName);
    '
    test ! -e lib/ohos/hdc.js
    test ! -e lib/ohos/ohos-aa.js
    if grep -RE 'HdcBackend|launchViaHdc|hdcScreenshot|hdcEnvironment|findHarmonybrewHdc' lib/ohos lib/coreBundle.js; then
      echo "removed backend remains in the artifact" >&2
      exit 1
    fi
  )

}

do_fetch
do_build
do_package
do_test
echo "==> done: $BUILD_DIR/$ARTIFACT"
