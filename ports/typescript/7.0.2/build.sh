#!/bin/sh
set -e

# ============================================================
# ohos-npm-ports: @ohos-npm-ports/typescript 7.0.2-3
#
# 构建方式：
#   1. 下载官方 typescript@7.0.2（JS wrapper：bin/tsc → getExePath → 平台二进制）
#   2. 打 patch：改名/版本、optionalDependencies 挂 openharmony 槽位包、
#      getExePath 在 openharmony 上解析槽位包
#   3. clone typescript-go 源码，本地编译 Go 二进制
#   4. 二进制 + noembed 声明文件装进平台槽位包
#      @ohos-npm-ports/typescript-openharmony-arm64（lib/tsc + lib/*.d.ts）
#
# 槽位包布局镜像上游平台包 @typescript/typescript-linux-arm64
# （lib/tsc + lib/*.d.ts，os/cpu 限定，preferUnplugged，无 main/bin）。
# 上游平台包里的 lib/tsc.sig 为上游发布流水线产物，运行时不校验，槽位包不带。
# ============================================================

PKG_NAME="typescript"
PKG_VERSION="7.0.2"
PORTS_VERSION="7.0.2-3"
SLOT_NAME="typescript-openharmony-arm64"
SLOT_PKG_NAME="@ohos-npm-ports/${SLOT_NAME}"
TSGO_TAG="typescript/v7.0.2"
WORK_DIR="$(pwd)"
BUILD_DIR="${WORK_DIR}/build"

# ===== deps =====
do_deps() {
    mkdir -p /data/storage/el2/base/cache
    mkdir -p /data/storage/el2/base/file
    brew install -y go git
}

# ===== fetch =====
do_fetch() {
    echo "=== fetch: 官方 typescript@${PKG_VERSION}（主包坯子）==="
    rm -rf "${BUILD_DIR}"
    mkdir -p "${BUILD_DIR}"
    npm pack "typescript@${PKG_VERSION}" --pack-destination "${BUILD_DIR}"
    tar -zxf "${BUILD_DIR}/typescript-${PKG_VERSION}.tgz" -C "${BUILD_DIR}"
    mv "${BUILD_DIR}/package" "${BUILD_DIR}/typescript-${PKG_VERSION}"

    echo "=== fetch: typescript-go 源码（只取当前 tag）==="
    git clone --depth 1 --branch "${TSGO_TAG}" \
        https://github.com/microsoft/typescript-go.git \
        "${BUILD_DIR}/typescript-go"
    cd "${BUILD_DIR}/typescript-go"
    patch -p1 < "${WORK_DIR}/patchs/0003-skip-fanotify-on-hongmeng.patch"
}

# ===== build =====
do_build() {
    echo "=== build: 编译 tsgo ==="
    mkdir -p "${BUILD_DIR}/${SLOT_NAME}/lib"
    cd "${BUILD_DIR}/typescript-go"
    go build \
        -ldflags="-s -w" \
        -trimpath \
        -tags=noembed \
        -o "${BUILD_DIR}/${SLOT_NAME}/lib/tsc" \
        ./cmd/tsgo

    echo "=== build: 复制 noembed 模式需要的 lib 声明文件（与二进制同目录）==="
    cp "${BUILD_DIR}/typescript-go/internal/bundled/libs/"*.d.ts \
        "${BUILD_DIR}/${SLOT_NAME}/lib/"

    echo "=== build: 二进制自检（容器内直接执行）==="
    "${BUILD_DIR}/${SLOT_NAME}/lib/tsc" --version
}

# ===== package =====
do_package() {
    echo "=== package: 主包打 patch（改名/版本/槽位接线）==="
    cd "${BUILD_DIR}/typescript-${PKG_VERSION}"
    patch -p1 < "${WORK_DIR}/patchs/0001-update-package-json.patch"
    patch -p1 < "${WORK_DIR}/patchs/0002-add-openharmony-support.patch"

    echo "=== package: 组装槽位包 ==="
    cp "${BUILD_DIR}/typescript-${PKG_VERSION}/LICENSE" "${BUILD_DIR}/${SLOT_NAME}/LICENSE"
    cp "${BUILD_DIR}/typescript-${PKG_VERSION}/NOTICE.txt" "${BUILD_DIR}/${SLOT_NAME}/NOTICE.txt"
    cat > "${BUILD_DIR}/${SLOT_NAME}/package.json" <<EOF
{
  "name": "${SLOT_PKG_NAME}",
  "version": "${PORTS_VERSION}",
  "description": "OpenHarmony arm64 native tsgo binary for @ohos-npm-ports/typescript",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/ohos-npm-ports/ohos-npm-ports.git",
    "directory": "ports/typescript/${PKG_VERSION}"
  },
  "license": "Apache-2.0",
  "preferUnplugged": true,
  "os": ["openharmony"],
  "cpu": ["arm64"],
  "files": ["lib", "LICENSE", "NOTICE.txt"],
  "publishConfig": { "access": "public" }
}
EOF
}

# ===== test =====
do_test() {
    cd "${BUILD_DIR}"
    echo "=== test: 槽位包二进制 ==="
    readelf -h "${SLOT_NAME}/lib/tsc" | grep -q AArch64
    test -s "${SLOT_NAME}/lib/lib.d.ts"

    echo "=== test: 主包接线（版本/槽位 optionalDependencies/getExePath 指向）==="
    node -e '
        const fs = require("fs");
        const main = JSON.parse(fs.readFileSync(process.argv[1] + "/package.json", "utf8"));
        if (main.name !== "@ohos-npm-ports/typescript") process.exit(1);
        if (main.version !== process.argv[2]) process.exit(1);
        if (main.optionalDependencies["@ohos-npm-ports/typescript-openharmony-arm64"] !== process.argv[2]) process.exit(1);
    ' "${BUILD_DIR}/typescript-${PKG_VERSION}" "${PORTS_VERSION}"
    grep -qF "@ohos-npm-ports/typescript-openharmony-arm64" \
        "${BUILD_DIR}/typescript-${PKG_VERSION}/lib/getExePath.js"

    echo "=== test: 槽位包二进制真跑 typecheck ==="
    SMOKE="$(mktemp -d)"
    cd "${SMOKE}"
    printf '{"compilerOptions":{"strict":true}}' > tsconfig.json
    printf 'const n: number = "x";\n' > bad.ts
    "${BUILD_DIR}/${SLOT_NAME}/lib/tsc" --version
    "${BUILD_DIR}/${SLOT_NAME}/lib/tsc" --noEmit -p tsconfig.json > out.txt 2>&1 || true
    grep -q 'error TS' out.txt || { cat out.txt >&2; exit 1; }
    cd "${BUILD_DIR}"
    rm -rf "${SMOKE}"

    echo "OK: ${SLOT_PKG_NAME} + @ohos-npm-ports/${PKG_NAME} ${PORTS_VERSION}"
}

do_deps
do_fetch
do_build
do_package
do_test
