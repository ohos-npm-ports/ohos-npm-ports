#!/bin/sh
set -e

# 准备编译环境
source ../../../setup-tools.sh

# 准备源码
curl -fsSL https://github.com/napi-rs/node-rs/archive/refs/tags/@node-rs/crc32@1.10.6.tar.gz -o node-rs--node-rs-crc32-1.10.6.tar.gz
tar -zxf node-rs--node-rs-crc32-1.10.6.tar.gz
cd node-rs--node-rs-crc32-1.10.6
patch -p1 < ../patchs/0001-update-package-json.patch

# Python 3.12+ 移除了 distutils，node-gyp 依赖它，需要通过 pip 安装 setuptools 提供
python3 -m pip install --break-system-packages setuptools

# 构建 addon
npm install
npm run prebuild

# 把其他平台的预构建产物复制到包里面一起发布
cd ..
curl -fsSL https://registry.npmjs.org/@node-rs/crc32/-/crc32-1.10.6.tgz -o node-rs--node-rs-crc32-1.10.6.tgz
tar -zxf node-rs--node-rs-crc32-1.10.6.tgz
rm node-rs--node-rs-crc32-1.10.6.tgz
if [ ! -d node-rs--node-rs-crc32-1.10.6/prebuilds ]; then
  mkdir -p node-rs--node-rs-crc32-1.10.6/prebuilds
fi
if [ -d patchs/prebuilds ]; then
  cp -r package/prebuilds/* node-rs--node-rs-crc32-1.10.6/prebuilds/
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
