#!/bin/sh
set -e

# 准备编译环境
source ../../../setup-tools.sh

# 准备源码
curl -fsSL https://github.com/websockets/bufferutil/archive/refs/tags/v4.0.8.tar.gz -o bufferutil-4.0.8.tar.gz
tar -zxf bufferutil-4.0.8.tar.gz
cd bufferutil-4.0.8
patch -p1 < ../patchs/0001-update-package-json.patch

# Python 3.12+ 移除了 distutils，node-gyp 依赖它，需要通过 pip 安装 setuptools 提供
python3 -m pip install --break-system-packages setuptools

# 构建 addon
npm install
npm run prebuild

# 把其他平台的预构建产物复制到包里面一起发布
cd ..
curl -fsSL https://registry.npmjs.org/bufferutil/-/bufferutil-4.0.8.tgz -o bufferutil-4.0.8.tgz
tar -zxf bufferutil-4.0.8.tgz
rm bufferutil-4.0.8.tgz
cp -r package/prebuilds/* bufferutil-4.0.8/prebuilds/
cd bufferutil-4.0.8/prebuilds
echo "=== Listing all files in prebuilds directory ==="
find "$(pwd)" -type f
echo "=== End of listing ==="
for dir in */; do
  if [ -f "${dir}bufferutil.node" ]; then
    mv "${dir}bufferutil.node" "${dir}@ohos-npm-ports+bufferutil.node"
  fi
  if [ -f "${dir}node.napi.node" ]; then
    mv "${dir}node.napi.node" "${dir}@ohos-npm-ports+bufferutil.node"
  fi
  if [ -f "${dir}@ohos-npm-ports+bufferutil.node" ]; then
    if llvm-readelf -S "${dir}@ohos-npm-ports+bufferutil.node" 2>/dev/null | grep -q '\.codesign'; then
      echo "[SIGNED]   ${dir}@ohos-npm-ports+bufferutil.node"
    elif readelf -S "${dir}@ohos-npm-ports+bufferutil.node" 2>/dev/null | grep -q '\.codesign'; then
      echo "[SIGNED]   ${dir}@ohos-npm-ports+bufferutil.node"
    else
      echo "[UNSIGNED] ${dir}@ohos-npm-ports+bufferutil.node"
    fi
  fi
done
