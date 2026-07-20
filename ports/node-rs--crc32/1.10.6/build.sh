#!/bin/sh
set -e

# 准备编译环境
source ../../../setup-tools.sh

# @node-rs/crc32 是 Rust/napi-rs 项目，CI 环境无法安装 Rust 工具链，
# 因此不从源码编译，而是从 npm 下载原始包获取各平台 prebuilds，
# OpenHarmony 的 .node 文件需要预先编译好放在 patchs/prebuilds/ 中。

# 从 npm 下载原始包
curl -fsSL https://registry.npmjs.org/@node-rs/crc32/-/crc32-1.10.6.tgz -o node-rs--node-rs-crc32-1.10.6.tgz
tar -zxf node-rs--node-rs-crc32-1.10.6.tgz
rm node-rs--node-rs-crc32-1.10.6.tgz

# 应用 patch 修改 package.json 和 index.js
cd node-rs--node-rs-crc32-1.10.6
patch -p1 < ../patchs/0001-update-package-json.patch
cd ..

# 确保 prebuilds 目录存在
if [ ! -d node-rs--node-rs-crc32-1.10.6/prebuilds ]; then
  mkdir -p node-rs--node-rs-crc32-1.10.6/prebuilds
fi

# 从 patchs/prebuilds/ 复制预编译的 OpenHarmony .node 文件
if [ -d patchs/prebuilds ]; then
  cp -r patchs/prebuilds/* node-rs--node-rs-crc32-1.10.6/prebuilds/
fi

cd node-rs--node-rs-crc32-1.10.6/prebuilds/
echo "=== Listing all files in prebuilds directory ==="
find "$(pwd)" -type f
echo "=== End of listing ==="
for dir in */; do
  if [ -f "${dir}crc32.openharmony-arm64.node" ]; then
    mv "${dir}crc32.openharmony-arm64.node" "${dir}@ohos-npm-ports+crc32.openharmony-arm64.node"
  fi
  if [ -f "${dir}node.napi.node" ]; then
    mv "${dir}node.napi.node" "${dir}@ohos-npm-ports+crc32.openharmony-arm64.node"
  fi
# 校验是否做了签名
  if [ -f "${dir}@ohos-npm-ports+crc32.openharmony-arm64.node" ]; then
    if llvm-readelf -S "${dir}@ohos-npm-ports+crc32.openharmony-arm64.node" 2>/dev/null | grep -q '\.codesign'; then
      echo "[SIGNED]   ${dir}@ohos-npm-ports+crc32.openharmony-arm64.node"
    elif readelf -S "${dir}@ohos-npm-ports+crc32.openharmony-arm64.node" 2>/dev/null | grep -q '\.codesign'; then
      echo "[SIGNED]   ${dir}@ohos-npm-ports+crc32.openharmony-arm64.node"
    else
      echo "[UNSIGNED] ${dir}@ohos-npm-ports+crc32.openharmony-arm64.node"
    fi
  fi
done
