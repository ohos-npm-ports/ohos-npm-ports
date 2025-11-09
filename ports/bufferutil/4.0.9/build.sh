#!/bin/sh
set -e

# 准备编译环境
source ../../../setup-tools.sh
source ../../../setup-env.sh

# 准备源码
curl -L https://github.com/websockets/bufferutil/archive/refs/tags/v4.0.9.tar.gz -o bufferutil-4.0.9.tar.gz
tar -zxf bufferutil-4.0.9.tar.gz
cd bufferutil-4.0.9
patch -p1 < ../patchs/0001-update-package-json.patch

# 构建 addon
npm install
npm run prebuild

# 代码签名
binary-sign-tool sign -inFile prebuilds/openharmony-arm64/@ohos-npm-ports+bufferutil.node -outFile prebuilds/openharmony-arm64/@ohos-npm-ports+bufferutil.node -selfSign 1

# 把其他平台的预构建产物复制到包里面一起发布
cd ..
curl -L https://registry.npmjs.org/bufferutil/-/bufferutil-4.0.9.tgz -o bufferutil-4.0.9.tgz
tar -zxf bufferutil-4.0.9.tgz
rm bufferutil-4.0.9.tgz
cp -r package/prebuilds/* bufferutil-4.0.9/prebuilds/
cd bufferutil-4.0.9/prebuilds
mv linux-x64/bufferutil.node linux-x64/@ohos-npm-ports+bufferutil.node
mv win32-ia32/bufferutil.node win32-ia32/@ohos-npm-ports+bufferutil.node
mv win32-x64/bufferutil.node win32-x64/@ohos-npm-ports+bufferutil.node
mv darwin-x64+arm64/bufferutil.node darwin-x64+arm64/@ohos-npm-ports+bufferutil.node
