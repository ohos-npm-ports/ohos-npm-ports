#!/bin/sh
set -e

# Fork 重打包：官方 @parcel/watcher tgz + 源码构建的 openharmony binding。
# index.js 的平台解析是动态拼名（@parcel/watcher-${platform}-${arch}），
# OHOS 上拼出的平台包不存在，require 的 MODULE_NOT_FOUND 被上游 handleError
# 吞掉后回落 require('./build/Release/watcher.node')——binding 按这个官方
# 兜底路径内嵌，index.js 零改动。非 OHOS 平台走上游 optionalDependencies
# 平台包，行为不变（0002 删掉 install script：其 build-from-source 回落会
# 在消费者机器上触发 node-gyp 编译）。
#
# 2.5.1-2：让"动态拼名"在两类环境都能命中——
#   a) 普通安装：optionalDependencies 增加 alias
#      "@parcel/watcher-openharmony-arm64" ->
#      npm:@ohos-npm-ports/parcel-watcher-openharmony-arm64@2.5.1-2
#      （os:["openharmony"] 平台过滤，OHOS 安装时自动拉取，其他平台跳过；
#      该 port 未发布前拉取失败也只是 optional 降级，不阻塞安装）
#   b) bun --compile 单二进制：wrapper.js 顶部静态引用该平台包（0003），
#      让 bundler 把它进内嵌模块表——运行时动态拼名 require 按 specifier
#      命中（.node 直接作 main 不进模块表，故配套 port 的 main 是
#      index.js shim 转出口）

VERSION=2.5.1
PKG=parcel-watcher
PORT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT="$PORT_DIR"

CURL="curl -fsSL --retry 8 --retry-all-errors --connect-timeout 30 --speed-limit 10240 --speed-time 30"

# --- binding 源码构建（容器 clang host 即 ohos，node-gyp 直编） ---
cd "$ROOT"
$CURL "https://github.com/parcel-bundler/watcher/archive/refs/tags/v${VERSION}.tar.gz" \
  -o "watcher-${VERSION}.tar.gz"
tar -zxf "watcher-${VERSION}.tar.gz"
rm "watcher-${VERSION}.tar.gz"
cd "watcher-${VERSION}"

# 0001 移除 watchman 后端：OHOS 无 watchman，linux default 后端会先试它
# （连接探测误判成功后 BSER 解析垃圾数据 SIGABRT）；去掉后 default 恒走
# inotify。toybox patch 会静默 no-op，打完 grep marker。
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

# --- 官方 tgz 重打包 ---
cd "$ROOT"
$CURL "https://registry.npmjs.org/@parcel/watcher/-/watcher-${VERSION}.tgz" -o watcher.tgz
tar -zxf watcher.tgz
rm watcher.tgz
mv package "${PKG}-${VERSION}"
cp "${PKG}-${VERSION}/index.js" "$ROOT"/index.js.upstream
cp "${PKG}-${VERSION}/wrapper.js" "$ROOT"/wrapper.js.upstream
cd "${PKG}-${VERSION}"
patch -p1 < ../patchs/0002-package-json.patch
patch -p1 < ../patchs/0003-wrapper-static-slot-ref.patch
# 0003 marker：静态引用行必须真的打上（toybox patch 静默 no-op 防线）
grep -q "require('@parcel/watcher-openharmony-arm64')" wrapper.js
mkdir -p build/Release
cp "${ROOT}/watcher-${VERSION}/build/Release/watcher.node" build/Release/watcher.node

# --- verify package contents ---

# 跨平台：index.js 与上游逐字节一致（loader 行为不变的构造性证明）
cmp "$ROOT"/index.js.upstream index.js && rm -f "$ROOT"/index.js.upstream \
  && echo "index.js byte-identical to upstream"
# wrapper.js 仅 0003 的头部静态引用差异（头 6 行外与上游一致）
tail -n +7 wrapper.js | cmp - "$ROOT"/wrapper.js.upstream \
  && rm -f "$ROOT"/wrapper.js.upstream \
  && echo "wrapper.js identical to upstream below the 0003 header"

NAME=$(node -e "console.log(require('./package.json').name)")
[ "$NAME" = "@ohos-npm-ports/${PKG}" ]

node -e '
  const pkg = require("./package.json");
  if (pkg.version !== "2.5.1-2") throw new Error(`bad version: ${pkg.version}`);
  const n = Object.keys(pkg.optionalDependencies ?? {}).length;
  if (n !== 14) throw new Error(`optionalDependencies count: ${n}, expected 14`);
  if (pkg.optionalDependencies["@parcel/watcher-linux-arm64-musl"] !== "2.5.1")
    throw new Error("platform subpackage version drifted");
  const alias = pkg.optionalDependencies["@parcel/watcher-openharmony-arm64"];
  if (alias !== "npm:@ohos-npm-ports/parcel-watcher-openharmony-arm64@2.5.1-2")
    throw new Error(`openharmony alias drifted: ${alias}`);
  if ("install" in (pkg.scripts ?? {})) throw new Error("install script must be dropped");
  console.log("package.json rewrite OK");
'

node --check index.js
node --check wrapper.js

readelf -h build/Release/watcher.node | grep -q 'AArch64'
readelf -S build/Release/watcher.node | grep -q '\.codesign'
readelf -d build/Release/watcher.node | grep -q 'libc\.so'

# 真函数冒烟：openharmony 上 require 本包根——index.js 拼出的平台包当前
# 未安装（optional alias 在本构建目录里拉不到未发布的配套 port），
# 走官方兜底路径命中内嵌 binding；真实扫一次目录并落快照文件。
# 跨平台模拟：伪造 process.platform=linux 验证拼名缺失时兜底链不崩（真实
# linux 用户的平台包由 optionalDependencies 在 require(name) 一步命中）
npm install --ignore-scripts --no-audit --no-fund --silent
node -e '
Object.defineProperty(process, "platform", { value: "linux" });
const b = require("./");
if (typeof b.writeSnapshot !== "function") throw new Error("writeSnapshot missing");
console.log("linux platform simulation: fallback chain OK");
'
node -e '
const b = require("./");
const fs = require("fs"), path = require("path"), os = require("os");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-"));
fs.writeFileSync(path.join(dir, "a.txt"), "x");
const snap = path.join(os.tmpdir(), "pw-snap.txt");
b.writeSnapshot(dir, snap, {}).then(
  () => {
    if (!fs.existsSync(snap)) { console.error("snapshot file missing"); process.exit(1); }
    console.log("OK: writeSnapshot (fallback build/Release path)");
  },
  (e) => { console.error("writeSnapshot failed:", e.message); process.exit(1); }
);'
rm -rf node_modules package-lock.json

# 消费侧冒烟：npm pack 后按名安装（file: 目录是 symlink，不装依赖）
cd "$ROOT"
rm -rf smoke && mkdir smoke && cd smoke
echo '{"name":"pw-smoke","private":true}' > package.json
npm pack --silent "../${PKG}-${VERSION}" > /dev/null
npm install --no-audit --no-fund "./ohos-npm-ports-${PKG}-${VERSION}-2.tgz" > /dev/null
node -e "const b = require('@ohos-npm-ports/${PKG}'); console.log('consumer smoke:', typeof b.writeSnapshot)"

cd "$ROOT"
rm -rf smoke

echo "OK: @ohos-npm-ports/${PKG}@${VERSION}-2"
