#!/bin/sh
set -e

# 源码构建：从 yuku 的 tag tarball 交叉编译 yuku-codegen 的 napi binding
# （zig aarch64-linux-musl，OHOS 同 libc 族；产物是源码编译，非下载）。
# 上游 loader 的 openharmony 分支第一候选就是包内
# @yuku-codegen/binding-openharmony-arm64/yuku-codegen.node，所以无需 patch loader。

VERSION=0.7.0
ZIG_VERSION=0.16.0
ZIG_SHA256=ea4b09bfb22ec6f6c6ceac57ab63efb6b46e17ab08d21f69f3a48b38e1534f17

# 准备源码（curl tag tarball，参考 ports/bufferutil）
curl -fsSL "https://github.com/yuku-toolchain/yuku/archive/refs/tags/v${VERSION}.tar.gz" \
  -o "yuku-${VERSION}.tar.gz"
tar -zxf "yuku-${VERSION}.tar.gz"
rm "yuku-${VERSION}.tar.gz"

# zig 工具链（sha256 校验）
curl -fsSL --retry 5 -o zig.tar.xz \
  "https://ziglang.org/download/${ZIG_VERSION}/zig-aarch64-linux-${ZIG_VERSION}.tar.xz"
echo "${ZIG_SHA256}  zig.tar.xz" | sha256sum -c -
tar -xJf zig.tar.xz
rm zig.tar.xz
ZIG="$(pwd)/zig-aarch64-linux-${ZIG_VERSION}/zig"

cd "yuku-${VERSION}"

# 交叉编译：build runner 在容器 host 上执行，仅目标产物是 musl
"${ZIG}" build -Dtarget=aarch64-linux-musl -Doptimize=ReleaseFast

NODE_SRC="zig-out/lib/yuku-codegen.node"
[ -f "$NODE_SRC" ] || { echo "no yuku-codegen binary in zig-out" >&2; exit 1; }
readelf -h "$NODE_SRC" | grep -q 'AArch64'
cp "$NODE_SRC" "../yuku-codegen.node"
cd ..

# 重打包官方 npm 包，嵌入签名后的 binding
npm pack "yuku-codegen@${VERSION}" --pack-destination .
tar -zxf "yuku-codegen-${VERSION}.tgz"
rm "yuku-codegen-${VERSION}.tgz"
mv package "yuku-codegen-${VERSION}"

cd "yuku-codegen-${VERSION}"
patch -p1 < ../patchs/0001-update-package-json.patch

mkdir -p "@yuku-codegen/binding-openharmony-arm64"
binary-sign-tool sign -selfSign 1 -inFile "../yuku-codegen.node" \
  -outFile "@yuku-codegen/binding-openharmony-arm64/yuku-codegen.node"
chmod +x "@yuku-codegen/binding-openharmony-arm64/yuku-codegen.node"

# 验证：AArch64 + 已签名；再用真实 loader 冒烟（容器 node 的
# process.platform === 'openharmony'，正好命中植入的文件）
readelf -h "@yuku-codegen/binding-openharmony-arm64/yuku-codegen.node" | grep -q 'AArch64'
readelf -S "@yuku-codegen/binding-openharmony-arm64/yuku-codegen.node" | grep -q '\.codesign'
echo "OK: @ohos-npm-ports/yuku-codegen repacked with source-built binding"
node -e "const b = require('./binding.js'); console.log('loader smoke:', typeof b)"
