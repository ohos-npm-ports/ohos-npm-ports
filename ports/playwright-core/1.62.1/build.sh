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
VERSION="$UPSTREAM_VERSION-3"

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
grep -q 'ohosExecutablePath' packages/playwright-core/src/server/chromium/chromium.ts
grep -q 'closeReported' packages/playwright-core/src/ohos/launcher.ts
grep -q 'findHarmonybrewHdc' packages/playwright-core/src/ohos/hdc.ts
grep -q 'hdcEnvironment' packages/playwright-core/src/ohos/hdc.ts
grep -q 'hdcFailureMessage' packages/playwright-core/src/ohos/launcher.ts
grep -q "options.channel ?? 'chrome'" packages/playwright-core/src/ohos/launcher.ts

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

  # 设备浏览器相关的修改（executablePath、launchServer 关闭、hdc 查找与 HOME、报错）必须真的进了打包产物（coreBundle 由 esbuild 生成，标记写在源码里不代表产物里有）
  grep -q 'ohosExecutablePath' lib/coreBundle.js
  grep -q 'closeReported' lib/coreBundle.js
  grep -q 'findHarmonybrewHdc' lib/coreBundle.js
  grep -q 'hdcEnvironment' lib/coreBundle.js
  grep -q 'hdcFailureMessage' lib/coreBundle.js
  # openharmony 上 chromium.executablePath() 不能再抛 "Browser is not supported on current platform"：
  # 指定 HDC_BINARY 时必须原样返回它（只在 openharmony 上执行，其它平台走上游逻辑）
  node -e '
    if (process.platform !== "openharmony") { console.log("executablePath smoke skipped (not openharmony)"); process.exit(0); }
    process.env.HDC_BINARY = process.execPath;
    const { chromium } = require("./index.js");
    const p = chromium.executablePath();
    if (p !== process.execPath) throw new Error(`executablePath() = ${JSON.stringify(p)}`);
    console.log("executablePath smoke OK:", p);
  '
  # HDC_BINARY 未设、PATH 为空时：有 Harmonybrew ohos-sdk 就返回它的 hdc，没有就兜底为裸命令名 hdc
  # （与 HdcBackend 的兜底一致），都不能是空串（空串会让客户端抛“平台不支持”）
  node -e '
    if (process.platform !== "openharmony") process.exit(0);
    delete process.env.HDC_BINARY;
    process.env.PATH = "";
    const { chromium } = require("./index.js");
    const p = chromium.executablePath();
    if (p !== "hdc" && !/\/ohos-sdk\/(toolchains|bin)\/hdc$/.test(p)) throw new Error(`executablePath() fallback = ${JSON.stringify(p)}`);
    console.log("executablePath fallback smoke OK:", p);
  '
  # 默认浏览器是海泰浏览器（chrome 通道，com.haitai.htbrowser）；HARMONY_BROWSER 仍可覆盖
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
  # 调用方隔离了 HOME 时，HdcBackend 必须用真实用户目录起 hdc（hdc 的服务和授权都在 HOME 下）：
  # 能确定真实目录时，spawn 用的 env 里的 HOME 必须是一个存在的目录且不是被隔离的那个；
  # 确定不了（既没有 userInfo 也没有固定目录）时不覆盖，保持原样
  node -e '
    if (process.platform !== "openharmony") process.exit(0);
    const os = require("os"), fs = require("fs");
    const isolated = fs.mkdtempSync(os.tmpdir() + "/pw-isolated-home-");
    process.env.HOME = isolated;
    const { HdcBackend } = require("./lib/ohos");
    const env = new HdcBackend()._env;
    if (env === undefined) {
      console.log("hdc HOME smoke OK: real home not determinable, HOME left as is");
    } else {
      if (env.HOME === isolated) throw new Error("hdc env HOME is still the isolated one");
      if (!fs.statSync(env.HOME).isDirectory()) throw new Error(`hdc env HOME is not a directory: ${env.HOME}`);
      console.log("hdc HOME smoke OK:", env.HOME);
    }
    fs.rmdirSync(isolated);
  '
  # hdc 连不上时 launch() 的报错必须带上 hdc 的真实错误，不能被吞成“browser ... is not installed”。
  # 用假的 hdc 脚本模拟两种情况：hdc 报 [Fail] 但退出码为 0（它的常见失败方式）→ 报错里要有这行；
  # hdc 正常回答但没有这个包 → 仍然是“is not installed”。只在 openharmony 上执行（launch 的 hdc 流程只在那里走）。
  node -e '
    if (process.platform !== "openharmony") { console.log("hdc error smoke skipped (not openharmony)"); process.exit(0); }
    const fs = require("fs"), os = require("os"), path = require("path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-fake-hdc-"));
    const fake = path.join(dir, "hdc");
    fs.writeFileSync(fake, "#!/bin/sh\ncase \"$*\" in\n  \"list targets\") echo fake-device ;;\n  *) echo \"$FAKE_HDC_REPLY\" ;;\nesac\n", { mode: 0o755 });
    process.env.HDC_BINARY = fake;
    delete process.env.HARMONY_BROWSER;
    const { chromium } = require("./index.js");
    const attempt = async (reply) => {
      process.env.FAKE_HDC_REPLY = reply;
      try { await chromium.launch({ timeout: 20000 }); } catch (e) { return String(e.message); }
      throw new Error("launch() unexpectedly succeeded with a fake hdc");
    };
    (async () => {
      const failed = await attempt("[Fail]ExecuteCommand need connect-key? please confirm a device by help info");
      if (!failed.includes("need connect-key")) throw new Error(`hdc error swallowed: ${failed}`);
      if (failed.includes("is not installed")) throw new Error(`hdc failure reported as not installed: ${failed}`);
      const missing = await attempt("error: bundle not found");
      if (!missing.includes("is not installed on the device")) throw new Error(`missing bundle not reported: ${missing}`);
      console.log("hdc error reporting smoke OK");
      fs.rmSync(dir, { recursive: true, force: true });
      process.exit(0);
    })().catch(e => { console.error(e.message); process.exit(1); });
  '
)

echo "==> done: $ARTIFACT"
