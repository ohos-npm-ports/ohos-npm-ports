#!/bin/sh
set -e

# ============================================================
# ohos-npm-ports: @ohos-npm-ports/vite-plus 1.0.0-1
#
# 构建方式：
#   1. 下载官方 vite-plus@1.0.0 tgz 与 v1.0.0 源树（各钉 sha256），
#      clone vite-task 到 7d69d657
#   2. 源树打三个 patch：去 packageManager pin、放开 vite-task 的本地
#      [patch] 段(只放开除 vt 外的 10 个)、注入 @ohos-npm-ports
#      overrides；每步 grep marker
#   3. vite-task clone 上给 fspy_preload_unix 的 musl 闸门加 ohos 排除
#   4. rustup 装仓库钉的 nightly（补 ohos host triple），pnpm build
#      交叉编译出包内 openharmony binding
#   5. 重打包官方 tgz，嵌入签名 binding；ELF/签名/loader 接线断言
#
# 上游 loader（binding/index.cjs）已有 openharmony/arm64 分支，第一个候选
# 就是 ./vite-plus.openharmony-arm64.node，所以不需要 loader patch，也不需要
# postinstall 接线。
#
# fspy_preload_unix 必须留在依赖图里：fspy 通过 -Z bindeps 的 artifact 依赖
# 引用它产出的 cdylib，闸门只让它的 body 在 ohos 上不编译。
#
# toolchain：仓库 rust-toolchain.toml 钉的是 channel，但裸 rustup 会解析成
# stable —— stable 没有 aarch64-unknown-linux-ohos target（CI 实测
# "could not download nonexistent rust version 1.98.1-...-linux-ohos"）。
# 这里把 toolchain 名显式写成带 ohos host triple 的形式。
#
# 发布目录名由 publish.sh 约定为 <pkg>-<version>，必须留在 port 目录根下，
# 所以中间件放 STAGE，成品由 do_package 落到 OUT，do_test 不删 OUT。
# ============================================================

PKG_NAME="vite-plus"
PKG_VERSION="1.0.0"
PORTS_VERSION="1.0.0-1"
VITE_TASK_REV="7d69d6577ecf6bd83deee32186de59918a712873"
BINDING="binding/${PKG_NAME}.openharmony-arm64.node"

SHA256_TGZ="c6b900370b47e39d45ab316f3df03294c5fe04cb141284d211f78e1dd8c824d1"
SHA256_SRC="2ae9ff19a0c514e55ba76f4025cead2faff67c91da7dce152c60b71a040e5192"

RUST_CHANNEL="nightly-2026-08-02"
RUST_TOOLCHAIN="${RUST_CHANNEL}-aarch64-unknown-linux-ohos"

# 0.2.8 验证过的 npm 分发路径；11/12 的 npm 分发未必有可用的 ohos engine
PNPM_VERSION="10"

WORK_DIR="$(pwd)"
STAGE="${WORK_DIR}/build"
OUT="${WORK_DIR}/${PKG_NAME}-${PKG_VERSION}"
# 0003 放开的 [patch] 路径是相对源树的 ../vite-task, 这里必须同址
VITE_TASK_DIR="${STAGE}/vite-task"

CURL="curl -fsSL --retry 8 --retry-all-errors --connect-timeout 30 --speed-limit 10240 --speed-time 30"

# ===== deps =====
do_deps() {
    echo "=== deps: brew rustup/git/cmake/openssl@3/zlib, npm pnpm ==="

    # setup-tools.sh only installs node/python/devel-base.
    # openssl@3/zlib: rustup 的 toolchain 按无版本 soname 链 libssl/libcrypto/libz。
    brew install -y rustup git cmake openssl@3 zlib
    npm install -g "pnpm@${PNPM_VERSION}"
}

# ===== fetch =====
do_fetch() {
    echo "=== fetch: 官方 tgz + v${PKG_VERSION} 源树 + vite-task ==="
    rm -rf "${STAGE}"
    mkdir -p "${STAGE}"
    cd "${STAGE}"

    $CURL "https://registry.npmjs.org/${PKG_NAME}/-/${PKG_NAME}-${PKG_VERSION}.tgz" -o tgz.tgz
    echo "${SHA256_TGZ}  tgz.tgz" | sha256sum -c -
    tar -zxf tgz.tgz
    rm tgz.tgz
    mv package tgz

    $CURL "https://github.com/voidzero-dev/${PKG_NAME}/archive/refs/tags/v${PKG_VERSION}.tar.gz" -o src.tar.gz
    echo "${SHA256_SRC}  src.tar.gz" | sha256sum -c -
    tar -zxf src.tar.gz
    rm src.tar.gz
    mv "${PKG_NAME}-${PKG_VERSION}" src

    if [ ! -d "${VITE_TASK_DIR}/.git" ]; then
        git clone -q https://github.com/voidzero-dev/vite-task.git "${VITE_TASK_DIR}"
        git -C "${VITE_TASK_DIR}" fetch -q --depth 1 origin "${VITE_TASK_REV}"
        git -C "${VITE_TASK_DIR}" checkout -q "${VITE_TASK_REV}"
    fi
}

# ===== build =====
do_build() {
    echo "=== build: 源树打 patch + vite-task 闸门 + 交叉编译 binding ==="

    cd "${STAGE}/src"
    patch -p1 < "${WORK_DIR}/patchs/0002-remove-package-manager-pin.patch"
    # `! grep` 不会让 set -e 中止, 断言必须写成可判定的形式
    if grep -q '"packageManager"' package.json; then
        echo "ERROR: 0002 did not remove packageManager" >&2
        exit 1
    fi
    patch -p1 < "${WORK_DIR}/patchs/0003-enable-local-vite-task-patch-section.patch"
    if ! grep -q '^\[patch\."https://github.com/voidzero-dev/vite-task.git"\]$' Cargo.toml; then
        echo "ERROR: 0003 did not enable the vite-task [patch] section" >&2
        exit 1
    fi
    # vt 必须留在 git 依赖上: toolchain.config.json 给它声明了 revision: true,
    # build.ts 要从 cargo metadata 读 40 位 git revision, patch 成 path 就读不到
    if grep -q '^vt = { path = ' Cargo.toml; then
        echo "ERROR: 0003 must not patch vt onto a path" >&2
        exit 1
    fi

    export NPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS=false
    export npm_config_manage_package_manager_versions=false

    # rustup 状态留在 port 目录内: CI 以临时用户跑, 不该写 $HOME
    export RUSTUP_HOME="${STAGE}/rustup-home"
    export CARGO_HOME="${STAGE}/cargo-home"
    rustup toolchain install "${RUST_TOOLCHAIN}" --profile minimal --component rust-src
    export RUSTUP_TOOLCHAIN="${RUST_TOOLCHAIN}"
    export PATH="${RUSTUP_HOME}/toolchains/${RUST_TOOLCHAIN}/bin:${PATH}"

    # `-Z bindeps` (fspy preload artifact deps) 在 stable 上需要它
    export RUSTC_BOOTSTRAP=1

    # @napi-rs/cli 由此定位 ohos 的 linker/cc/ar
    if [ -z "${OHOS_SDK_NATIVE:-}" ]; then
        sdk="$(brew --prefix)/opt/ohos-sdk"
        [ -d "${sdk}/native" ] && OHOS_SDK_NATIVE="${sdk}/native" && export OHOS_SDK_NATIVE
    fi
    if [ -z "${OHOS_SDK_NATIVE:-}" ]; then
        echo "ERROR: OHOS_SDK_NATIVE not set" >&2
        exit 1
    fi

    if ! $CURL -fsIL --max-time 8 -o /dev/null "https://index.crates.io/config.json" 2>/dev/null; then
        export CARGO_REGISTRIES_CRATES_IO_INDEX="sparse+https://rsproxy.cn/index/"
    fi

    cd "${VITE_TASK_DIR}"
    patch -p1 < "${WORK_DIR}/patchs/0004-fspy-ohos-exemption.patch"
    if [ "$(grep -c 'not(target_env = "ohos")' crates/fspy_preload_unix/src/lib.rs)" -ne 4 ]; then
        echo "ERROR: 0004 did not add the ohos exemption" >&2
        exit 1
    fi
    cd "${STAGE}/src"

    # pnpm-workspace 引用的 rolldown / vite, 源 tarball 里没有
    node packages/tools/src/index.ts sync-remote

    patch -p1 < "${WORK_DIR}/patchs/0005-add-ohos-port-overrides.patch"
    if ! grep -q -- "- '@ohos-npm-ports/\*'" pnpm-workspace.yaml; then
        echo "ERROR: 0005 did not add the port scope to minimumReleaseAgeExclude" >&2
        exit 1
    fi

    # 注入的 overrides 与源 tarball 自带的 lockfile 不一致
    pnpm install --no-frozen-lockfile
    pnpm build

    test -f "packages/cli/${BINDING}" || {
        echo "ERROR: packages/cli/${BINDING} not built" >&2
        exit 1
    }
    readelf -h "packages/cli/${BINDING}" | grep -q 'AArch64'
}

# ===== package =====
do_package() {
    echo "=== package: 重打包官方 tgz + 嵌入签名 binding + manifest 断言 ==="

    rm -rf "${OUT}"
    cp -a "${STAGE}/tgz" "${OUT}"
    cd "${OUT}"
    patch -p1 < "${WORK_DIR}/patchs/0001-update-package-json.patch"

    binary-sign-tool sign -selfSign 1 \
        -inFile "${STAGE}/src/packages/cli/${BINDING}" \
        -outFile "${BINDING}"

    node -e '
      const p = require("./package.json");
      if (p.name !== "@ohos-npm-ports/vite-plus") { console.error("bad name: " + p.name); process.exit(1); }
      if (p.version !== "1.0.0-1") { console.error("bad version: " + p.version); process.exit(1); }
      console.log("OK: manifest");
    '
}

# ===== test =====
do_test() {
    echo "=== test: ELF/签名 + loader 接线断言 ==="
    cd "${OUT}"

    readelf -h "${BINDING}" | grep -q 'AArch64'
    readelf -S "${BINDING}" | grep -q '\.codesign'
    test ! -x "${BINDING}"

    # loader 的第一个候选必须就是上面这个文件, 否则 openharmony 上取不到
    grep -q "process.platform === 'openharmony'" binding/index.cjs
    grep -q "require('./${PKG_NAME}.openharmony-arm64.node')" binding/index.cjs

    cd "${WORK_DIR}"
    rm -rf "${STAGE}"
    test -d "${OUT}"
}

do_deps
do_fetch
do_build
do_package
do_test

echo "OK: @ohos-npm-ports/${PKG_NAME} ${PORTS_VERSION} built and verified"
