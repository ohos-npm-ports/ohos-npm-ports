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
mv linux-x64/bufferutil.node linux-x64/@ohos-npm-ports+bufferutil.node
mv win32-ia32/bufferutil.node win32-ia32/@ohos-npm-ports+bufferutil.node
mv win32-x64/bufferutil.node win32-x64/@ohos-npm-ports+bufferutil.node
mv darwin-x64+arm64/bufferutil.node darwin-x64+arm64/@ohos-npm-ports+bufferutil.node
