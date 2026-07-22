#!/bin/sh
set -e

# ============================================================
# ohos-npm-ports: @ohos-npm-ports/typescript 7.0.2-1
#
# 构建方式：
#   1. 下载官方 typescript@7.0.2 包
#   2. 打 patch 改名
#   3. clone typescript-go 源码，本地编译 Go 二进制
#   4. 将二进制内嵌到包中
#   5. 修改 getExePath.js 以支持 OpenHarmony
# ============================================================

PKG_NAME="typescript"
PKG_VERSION="7.0.2"
PORTS_VERSION="7.0.2-1"
TSGO_TAG="typescript/v7.0.2"
WORK_DIR="$(pwd)"
BUILD_DIR="${WORK_DIR}/build"

mkdir -p /data/storage/el2/base/cache
mkdir -p /data/storage/el2/base/file
brew install -y go git

echo "=== 1/6: 清理旧构建目录 ==="
rm -rf "${BUILD_DIR}"
mkdir -p "${BUILD_DIR}"

echo "=== 2/6: 下载官方 typescript@${PKG_VERSION} ==="
npm pack "typescript@${PKG_VERSION}" --pack-destination "${BUILD_DIR}"
cd "${BUILD_DIR}"
tar -zxf "typescript-${PKG_VERSION}.tgz"
mv package "typescript-${PKG_VERSION}"
cd "typescript-${PKG_VERSION}"

echo "=== 3/6: 打 patch 修改包名和版本 ==="
patch -p1 < "${WORK_DIR}/patchs/0001-update-package-json.patch"

echo "=== 4/6: 编译 Go 原生二进制 ==="
# 克隆 typescript-go 源码（只取当前版本，不含历史）
git clone --depth 1 --branch "${TSGO_TAG}" \
    https://github.com/microsoft/typescript-go.git \
    "${BUILD_DIR}/typescript-go"

cd "${BUILD_DIR}/typescript-go"
go build \
    -ldflags="-s -w" \
    -trimpath \
    -tags=noembed \
    -o "${BUILD_DIR}/typescript-${PKG_VERSION}/lib/tsc" \
    ./cmd/tsgo

# 复制 lib 声明文件（noembed 模式需要与二进制同目录）
echo "--- 复制 lib 声明文件 ---"
cp "${BUILD_DIR}/typescript-go/internal/bundled/libs/"*.d.ts \
    "${BUILD_DIR}/typescript-${PKG_VERSION}/lib/"

# 验证二进制
file "${BUILD_DIR}/typescript-${PKG_VERSION}/lib/tsc"
echo "--- 验证 lib 文件 ---"
ls "${BUILD_DIR}/typescript-${PKG_VERSION}/lib/"lib.d.ts
echo "--- 测试二进制版本 ---"
"${BUILD_DIR}/typescript-${PKG_VERSION}/lib/tsc" --version 2>&1 || true

# 清理源码
rm -rf "${BUILD_DIR}/typescript-go"

echo "=== 5/6: 打 patch 增加 OpenHarmony 支持 ==="
cd "${BUILD_DIR}/typescript-${PKG_VERSION}"
patch -p1 < "${WORK_DIR}/patchs/0002-add-openharmony-support.patch"

echo "=== 6/6: 构建完成，验证包结构 ==="
echo ""
echo "--- 文件列表 ---"
find "${BUILD_DIR}/typescript-${PKG_VERSION}" -maxdepth 1 -type d | sort
echo ""
echo "--- lib/ 内容 ---"
ls -lh "${BUILD_DIR}/typescript-${PKG_VERSION}/lib/"
echo ""
echo "--- 二进制验证 ---"
file "${BUILD_DIR}/typescript-${PKG_VERSION}/lib/tsc"
echo ""
echo "--- 版本信息 ---"
"${BUILD_DIR}/typescript-${PKG_VERSION}/lib/tsc" --version 2>&1 || true
echo ""
echo "=== 构建成功！产物位于: ${BUILD_DIR}/typescript-${PKG_VERSION} ==="
echo "=== 运行 publish.sh 发布到 npm ==="
