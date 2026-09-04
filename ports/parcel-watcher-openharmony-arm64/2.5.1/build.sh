#!/bin/sh
set -e

# 源码构建 @parcel/watcher@2.5.1 的 openharmony 平台包（binding-only）。
# 消费方以 alias 安装到 @parcel/watcher-openharmony-arm64 槽位：
#   - 普通安装（node_modules 解析）：@parcel/watcher 的 index.js 在
#     platform === 'openharmony' 时动态拼名 require 本包名，一步命中
#   - bun --compile 单二进制：消费侧 wrapper.js 的静态引用让 bundler 把
#     本包进内嵌模块表，运行时动态拼名按 specifier 命中
# main 是 index.js shim 而非 .node 直出：bundler 只把 JS 模块登记进内嵌
# 模块表（.node 作 main 会被当 asset 内嵌、拼名 require 命不中），shim 内
# 的字面量 require('./watcher.node') 负责真正加载 binding。
# 0001 移除 watchman 后端：OHOS 无 watchman，default 后端连接探测误判
# 成功后 BSER 解析垃圾数据 SIGABRT；去掉后 default 恒走 inotify。

VERSION=2.5.1
PKG=parcel-watcher-openharmony-arm64
PORT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT="$PORT_DIR"

CURL="curl -fsSL --retry 8 --retry-all-errors --connect-timeout 30 --speed-limit 10240 --speed-time 30"

# --- binding 源码构建（容器 clang host 即 ohos，node-gyp 直编） ---
brew install -y node

cd "$ROOT"
$CURL "https://github.com/parcel-bundler/watcher/archive/refs/tags/v${VERSION}.tar.gz" \
  -o "watcher-${VERSION}.tar.gz"
tar -zxf "watcher-${VERSION}.tar.gz"
rm "watcher-${VERSION}.tar.gz"
cd "watcher-${VERSION}"

# 同 ports/parcel-watcher/2.5.1 的 0001（watchman 后端移除），marker 复验
patch -p1 < "${PORT_DIR}/patchs/0001-binding-gyp-drop-watchman.patch"
grep -q '"src/linux/InotifyBackend.cc"' binding.gyp
! grep -q 'WatchmanBackend' binding.gyp

npm install --ignore-scripts
npx -y node-gyp rebuild --nodedir="$(brew --prefix)"

test -f build/Release/watcher.node
binary-sign-tool sign -selfSign 1 \
  -inFile "build/Release/watcher.node" \
  -outFile "build/Release/watcher.node.signed"
mv "build/Release/watcher.node.signed" "build/Release/watcher.node"

# --- 组包（binding-only + shim） ---
cd "$ROOT"
mkdir "${PKG}-${VERSION}"
cp "watcher-${VERSION}/build/Release/watcher.node" "${PKG}-${VERSION}/watcher.node"
cat > "${PKG}-${VERSION}/index.js" <<'SHIM'
module.exports = require('./watcher.node')
SHIM
cat > "${PKG}-${VERSION}/package.json" <<JSON
{
  "name": "@ohos-npm-ports/${PKG}",
  "version": "${VERSION}-2",
  "description": "OpenHarmony (OHOS) arm64 platform binding for @parcel/watcher \\u2014 source-built inotify backend, main is a shim re-exporting watcher.node (bundler module-table embedding requires a JS entry)",
  "main": "index.js",
  "repository": {
    "type": "git",
    "url": "https://github.com/ohos-npm-ports/ohos-npm-ports.git",
    "directory": "ports/${PKG}/${VERSION}"
  },
  "license": "MIT",
  "files": [
    "index.js",
    "watcher.node"
  ],
  "engines": {
    "node": ">= 10.0.0"
  },
  "os": [
    "openharmony"
  ],
  "cpu": [
    "arm64"
  ]
}
JSON

# --- verify package contents ---
cd "${PKG}-${VERSION}"

NAME=$(node -e "console.log(require('./package.json').name)")
[ "$NAME" = "@ohos-npm-ports/${PKG}" ]
node -e '
  const pkg = require("./package.json");
  if (pkg.version !== "2.5.1-2") throw new Error(`bad version: ${pkg.version}`);
  if (pkg.main !== "index.js") throw new Error("main must be the shim");
  console.log("package.json OK");
'
node --check index.js
grep -q "require('./watcher.node')" index.js

readelf -h watcher.node | grep -q 'AArch64'
readelf -S watcher.node | grep -q '\.codesign'
readelf -d watcher.node | grep -q 'libc\.so'

# 真函数冒烟：default 后端（0001 后即 inotify）真实扫一次目录并落快照
node -e '
const b = require("./");
const fs = require("fs"), path = require("path"), os = require("os");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pws-"));
fs.writeFileSync(path.join(dir, "a.txt"), "x");
const snap = path.join(os.tmpdir(), "pws-snap.txt");
b.writeSnapshot(dir, snap, {}).then(
  () => {
    if (!fs.existsSync(snap)) { console.error("snapshot file missing"); process.exit(1); }
    console.log("OK: writeSnapshot (default=inotify)");
  },
  (e) => { console.error("writeSnapshot failed:", e.message); process.exit(1); }
);'

# 消费侧冒烟：npm pack 后按名安装（file: 目录是 symlink，不装依赖）
cd "$ROOT"
rm -rf smoke && mkdir smoke && cd smoke
echo '{"name":"pws-smoke","private":true}' > package.json
npm pack --silent "../${PKG}-${VERSION}" > /dev/null
npm install --no-audit --no-fund "./ohos-npm-ports-${PKG}-${VERSION}-2.tgz" > /dev/null
node -e "const b = require('@ohos-npm-ports/${PKG}'); console.log('consumer smoke:', typeof b.writeSnapshot)"

# 槽位冒烟：按 @parcel/watcher 的动态拼名（alias 安装形态）require 命中
mkdir -p node_modules/@parcel/watcher-openharmony-arm64
cp -r "node_modules/@ohos-npm-ports/${PKG}/." node_modules/@parcel/watcher-openharmony-arm64/
node -e '
const name = `@parcel/watcher-${process.platform}-${process.arch}`;   // 复刻 index.js 的拼名
const b = require(name);
if (typeof b.writeSnapshot !== "function") throw new Error("slot require missed");
console.log("slot-name require (dynamic name construction) OK:", name);
'

cd "$ROOT"
rm -rf smoke

echo "OK: @ohos-npm-ports/${PKG}@${VERSION}-2"
