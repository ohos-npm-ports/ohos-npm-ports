#!/bin/sh
set -e

# 准备编译环境
source ../../../setup-tools.sh
source ../../../setup-env.sh

# 准备源码
curl -L https://github.com/TryGhost/node-sqlite3/archive/refs/tags/v5.1.7.tar.gz -o node-sqlite3-5.1.7.tar.gz
tar -zxf node-sqlite3-5.1.7.tar.gz
cd node-sqlite3-5.1.7
patch -p1 < ../patchs/0001-change-prebuild-framework.patch

# 构建 addon
npm install
npm run prebuild

# 代码签名
binary-sign-tool sign -inFile ./prebuilds/openharmony-arm64/@ohos-npm-ports+sqlite3.node -outFile ./prebuilds/openharmony-arm64/@ohos-npm-ports+sqlite3.node -selfSign 1

# 把其他平台上的预构建产物复制到包里面一起发布
base_url="https://github.com/TryGhost/node-sqlite3/releases/download/v5.1.7"
platforms="darwin-arm64 darwin-x64 linux-arm64 linux-x64 linuxmusl-arm64 linuxmusl-x64 win32-ia32 win32-x64"
for platform in ${platforms}; do
    asset_name=sqlite3-v5.1.7-napi-v6-${platform}
    curl -L ${base_url}/${asset_name}.tar.gz -o ${asset_name}.tar.gz
    mkdir ${asset_name}
    tar -zxf ${asset_name}.tar.gz -C ${asset_name}
    mkdir ./prebuilds/${platform}
    cp ./${asset_name}/build/Release/node_sqlite3.node ./prebuilds/${platform}/@ohos-npm-ports+sqlite3.node
done
mv ./prebuilds/linux-arm64/@ohos-npm-ports+sqlite3.node ./prebuilds/linux-arm64/@ohos-npm-ports+sqlite3.glibc.node
mv ./prebuilds/linux-x64/@ohos-npm-ports+sqlite3.node ./prebuilds/linux-x64/@ohos-npm-ports+sqlite3.glibc.node
mv ./prebuilds/linuxmusl-arm64/@ohos-npm-ports+sqlite3.node ./prebuilds/linux-arm64/@ohos-npm-ports+sqlite3.musl.node
mv ./prebuilds/linuxmusl-x64/@ohos-npm-ports+sqlite3.node ./prebuilds/linux-x64/@ohos-npm-ports+sqlite3.musl.node
rm -rf ./sqlite3-v5.1.7-napi-v6*
rm -rf ./prebuilds/linuxmusl-arm64
rm -rf ./prebuilds/linuxmusl-x64
