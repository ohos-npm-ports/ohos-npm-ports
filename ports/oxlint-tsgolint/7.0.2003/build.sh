#!/bin/sh
set -e

# ============================================================
# ohos-npm-ports: @ohos-npm-ports/oxlint-tsgolint 7.0.2003-1
#
# 构建方式：
#   1. clone tsgolint v7.0.2003（含 typescript-go submodule），按上游 justfile
#      的方式打 patches/0*.patch，go build 出静态二进制
#   2. 下载官方 oxlint-tsgolint@7.0.2003 tarball，钉住 sha256
#   3. 打两个 patch：改写 manifest + 给 loader 加 openharmony 分支，grep marker
#   4. 签名后的二进制与槽位包 manifest 一起塞进
#      @oxlint-tsgolint/openharmony-arm64/
#   5. 哈希不变量 + ELF/签名断言 + 走真实入口的 lint 冒烟
#
# 上游 loader 直接按 process.platform 拼槽位包名，没有 openharmony 分支；
# 槽位包名因此固定为 @oxlint-tsgolint/openharmony-arm64。
# ============================================================

PKG_NAME="oxlint-tsgolint"
PKG_VERSION="7.0.2003"
PORTS_VERSION="7.0.2003-1"
SLOT="@oxlint-tsgolint/openharmony-arm64"
WORK_DIR="$(pwd)"
BUILD_DIR="${WORK_DIR}/build"

CURL="curl -fsSL --retry 8 --retry-all-errors --connect-timeout 30 --speed-limit 10240 --speed-time 30"

brew install -y go git

# ===== fetch =====
do_fetch() {
    echo "=== fetch: tsgolint v${PKG_VERSION} 源码 + 官方 npm tarball ==="
    rm -rf "${BUILD_DIR}"
    mkdir -p "${BUILD_DIR}"
    cd "${BUILD_DIR}"

    git clone --depth 1 --branch "v${PKG_VERSION}" \
        https://github.com/oxc-project/tsgolint.git tsgolint-src
    # git am 会造 commit，而 CI 容器里没有配 git identity
    git -C tsgolint-src config user.email port@example.com
    git -C tsgolint-src config user.name port
    git -C tsgolint-src submodule update --init --depth 1
    # git am 跑在 submodule 里，它有自己一份 git config
    git -C tsgolint-src/typescript-go config user.email port@example.com
    git -C tsgolint-src/typescript-go config user.name port

    $CURL "https://registry.npmjs.org/${PKG_NAME}/-/${PKG_NAME}-${PKG_VERSION}.tgz" -o src.tgz
    echo "86d3490dd9d558ca83b7ffa0184198d8f7229e788059ed82ab5d7c1d91109d33  src.tgz" | sha256sum -c -
    tar -zxf src.tgz
    rm src.tgz
    mv package src
}

# ===== build =====
do_build() {
    echo "=== build: typescript-go 补丁 + go build + 签名 ==="
    cd "${BUILD_DIR}/tsgolint-src"

    cd typescript-go
    git am --3way --no-gpg-sign ../patches/0*.patch
    cd ..
    mkdir -p internal/collections
    find ./typescript-go/internal/collections -type f ! -name '*_test.go' \
        -exec cp {} internal/collections/ \;

    # CI 环境的临时目录指向容器内不存在的设备路径，go 的 work dir 会失败；
    # GOTMPDIR 优先于 TMPDIR，缓存同理重定向到工作目录
    export GOTMPDIR="$PWD/.gotmpdir"
    export GOCACHE="$PWD/.gocache"
    export GOMODCACHE="$(brew --prefix)/var/go-mod-cache"
    mkdir -p "$GOTMPDIR" "$GOCACHE" "$GOMODCACHE"

    go build -ldflags="-s -w" -trimpath -o tsgolint ./cmd/tsgolint

    binary-sign-tool sign -selfSign 1 -inFile tsgolint -outFile tsgolint.signed
    chmod +x tsgolint.signed
    readelf -h tsgolint.signed | grep -q 'AArch64'
    readelf -l tsgolint.signed | grep -q INTERP && {
        echo "ERROR: not static" >&2; exit 1;
    } || true

    cd "${BUILD_DIR}/src"
    # do_test 拿它断言 patch 只改了 manifest 与 loader
    find . -type f -exec sha256sum {} + | sed 's|\./||' | sort > "${WORK_DIR}/before.sha256"
}

# ===== package =====
do_package() {
    echo "=== package: 打 patch + grep marker + 嵌入签名二进制与槽位 manifest ==="
    cd "${BUILD_DIR}/src"

    patch -p1 < "${WORK_DIR}/patchs/0001-update-package-json.patch"
    patch -p1 < "${WORK_DIR}/patchs/0002-openharmony-loader.patch"
    # patch 对零上下文 hunk 的越界行号会静默套用到文件末尾（exit 0）
    grep -q '"name": "@ohos-npm-ports/oxlint-tsgolint"' package.json
    grep -q '"version": "7.0.2003-1"' package.json
    grep -q "openharmony" bin/tsgolint.js
    node --check bin/tsgolint.js

    mkdir -p "${SLOT}"
    cp ../tsgolint-src/tsgolint.signed "${SLOT}/tsgolint"
    chmod +x "${SLOT}/tsgolint"
    cat > "${SLOT}/package.json" <<EOF
{
  "name": "${SLOT}",
  "version": "${PORTS_VERSION}",
  "description": "High-performance type-aware TypeScript linter powered by typescript-go, for use with oxlint. — OpenHarmony (OHOS) build",
  "license": "MIT",
  "preferUnplugged": true,
  "files": [
    "tsgolint"
  ],
  "os": [
    "openharmony"
  ],
  "cpu": [
    "arm64"
  ]
}
EOF
}

# ===== test =====
do_test() {
    echo "=== test: 哈希不变量 + ELF/签名 + 真实入口 lint 冒烟 ==="
    cd "${BUILD_DIR}/src"

    # 剔除 patch 允许改写的两个文件与组装新增的槽位文件，其余须逐字节一致
    find . -type f -exec sha256sum {} + | sed 's|\./||' | sort > "${WORK_DIR}/after.sha256"
    grep -v -e '  package\.json$' -e '  bin/tsgolint\.js$' \
        "${WORK_DIR}/before.sha256" > "${WORK_DIR}/before.filtered"
    grep -v -e '  package\.json$' -e '  bin/tsgolint\.js$' \
        -e "  ${SLOT}/tsgolint\$" -e "  ${SLOT}/package\.json\$" \
        "${WORK_DIR}/after.sha256" > "${WORK_DIR}/after.filtered"
    diff "${WORK_DIR}/before.filtered" "${WORK_DIR}/after.filtered"

    readelf -h "${SLOT}/tsgolint" | grep -q 'AArch64'
    readelf -S "${SLOT}/tsgolint" | grep -q '\.codesign'

    # oxlint 走的就是这条入口：lint 一个故意写错类型的文件，期望对应诊断
    SMOKE="${BUILD_DIR}/smoke"
    mkdir -p "${SMOKE}"
    cd "${SMOKE}"
    printf '{"compilerOptions":{"strict":true}}' > tsconfig.json
    printf 'const n = 1 as unknown as string | undefined;\n' > bad.ts
    "${BUILD_DIR}/src/bin/tsgolint.js" -tsconfig tsconfig.json bad.ts > out.txt 2>&1 || true
    grep -q 'no-unsafe-type-assertion' out.txt || { cat out.txt >&2; exit 1; }

    cd "${WORK_DIR}"
    rm -rf "${BUILD_DIR}"
    rm -f "${WORK_DIR}"/before.sha256 "${WORK_DIR}"/after.sha256 \
          "${WORK_DIR}"/before.filtered "${WORK_DIR}"/after.filtered
}

do_fetch
do_build
do_package
do_test

echo "OK: @ohos-npm-ports/${PKG_NAME} ${PORTS_VERSION} built and smoke-tested"
