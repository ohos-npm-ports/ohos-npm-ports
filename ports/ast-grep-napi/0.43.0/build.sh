#!/bin/sh
set -e

# 源码构建 @ast-grep/napi 的 Rust napi binding（vite-plus 构建期的
# module-rewrite 步骤依赖它；上游任何版本都不发布 openharmony 产物）。
# CI 容器是 OHOS rootfs + harmonybrew rust（host 即 aarch64-unknown-linux-ohos），
# 直接 host cargo build 产物就是原生 ohos ELF——与 ports/vite-plus/0.2.8
# 构建 binding 的方案一致。上游 loader 的 openharmony 分支第一候选是包内
# ./ast-grep-napi.openharmony-arm64.node，无需 patch loader。

VERSION=0.43.0

# 工具链（容器基础镜像不带 rust；cargo 由 rust bottle 提供）
brew install -y rust

# 准备源码（curl tag tarball，参考 ports/bufferutil）
curl -fsSL "https://github.com/ast-grep/ast-grep/archive/refs/tags/${VERSION}.tar.gz" \
  -o "ast-grep-${VERSION}.tar.gz"
tar -zxf "ast-grep-${VERSION}.tar.gz"
rm "ast-grep-${VERSION}.tar.gz"

cd "ast-grep-${VERSION}"

# crates.io 访问在网络受限环境会卡；探测后回退镜像
if ! curl -fsIL --max-time 8 -o /dev/null "https://index.crates.io/config.json" 2>/dev/null; then
  export CARGO_REGISTRIES_CRATES_IO_INDEX="sparse+https://rsproxy.cn/index/"
fi

cargo build -p ast-grep-napi --release

NODE_SRC=$(find target/release -maxdepth 1 -name 'libast_grep_napi.so' | head -1)
[ -n "$NODE_SRC" ] || { echo "no napi cdylib in target/release" >&2; exit 1; }
readelf -h "$NODE_SRC" | grep -q 'AArch64'
cp "$NODE_SRC" "../ast-grep-napi.node"
cd ..

# 重打包官方 npm 包，嵌入签名后的 binding
npm pack "@ast-grep/napi@${VERSION}" --pack-destination .
tar -zxf "ast-grep-napi-${VERSION}.tgz"
rm "ast-grep-napi-${VERSION}.tgz"
mv package "ast-grep-napi-${VERSION}"

cd "ast-grep-napi-${VERSION}"
patch -p1 < ../patchs/0001-update-package-json.patch

binary-sign-tool sign -selfSign 1 \
  -inFile "../ast-grep-napi.node" \
  -outFile "ast-grep-napi.openharmony-arm64.node"
chmod +x "ast-grep-napi.openharmony-arm64.node"

# 验证：AArch64 + 已签名；再用真实 loader 冒烟（容器 node 的
# process.platform === 'openharmony'，正好命中植入的文件）
readelf -h "ast-grep-napi.openharmony-arm64.node" | grep -q 'AArch64'
readelf -S "ast-grep-napi.openharmony-arm64.node" | grep -q '\.codesign'
echo "OK: @ohos-npm-ports/ast-grep-napi repacked with source-built binding"
node -e "const b = require('./index.js'); console.log('loader smoke:', typeof b)"
