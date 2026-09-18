#!/bin/sh
set -e

# ============================================================
# ohos-npm-ports: @ohos-npm-ports/pnpm 12.4.2-1
#
# 构建方式：
#   1. 下载 pnpm v12.4.2 源码 tag + pnpm@12.4.2 npm 包
#   2. 源码打补丁：vendor ohos-sign crate、store 入口自动签名 ELF、
#      host 平台上报 openharmony
#   3. cargo 构建 pnpm-cli，strip + 签名
#   4. 槽位包 @ohos-npm-ports/pnpm-openharmony-arm64 携带二进制
#   5. 主包 = 上游 npm wrapper 重打包：改名 + native-binary.mjs
#      增加 openharmony 平台分支
# ============================================================

PKG_NAME="pnpm"
PKG_VERSION="12.4.2"
PORTS_VERSION="12.4.2-1"
SLOT_NAME="pnpm-openharmony-arm64"
WORK_DIR="$(pwd)"
BUILD_DIR="${WORK_DIR}/build"

SRC_URL="https://github.com/pnpm/pnpm/archive/refs/tags/v${PKG_VERSION}.tar.gz"
SRC_SHA256="2fca2c303b978c8177c13550b2d0f8e442cf32b833bea7878421f90c18a7c612"
NPM_URL="https://registry.npmjs.org/pnpm/-/pnpm-${PKG_VERSION}.tgz"
NPM_SHA256="3bb1683c7bff8bf8a810284d8b38af46ac22e2a732fca88de299fdc6b88af814"
ITZ_URL="https://static.crates.io/crates/iana-time-zone/iana-time-zone-0.1.65.crate"
ITZ_SHA256="e31bc9ad994ba00e440a8aa5c9ef0ec67d5cb5e5cb0cc7f8b744a35b389cc470"

CURL="curl -fsSL --retry 8 --retry-all-errors --connect-timeout 30"

do_deps() {
    echo "=== deps: toolchain ==="
    mkdir -p /data/storage/el2/base/cache /data/storage/el2/base/file
    brew install -y rust cmake pkgconf
    # 镜像预装的 rustup shim 会按源码 rust-toolchain.toml 去拉镜像站没有的
    # ohos host 工具链，brew rust 前置顶掉它
    export PATH="$(brew --prefix rust)/bin:${PATH}"
    cargo --version
}

do_fetch() {
    echo "=== fetch: sources ==="
    rm -rf "${BUILD_DIR}"
    mkdir -p "${BUILD_DIR}"
    $CURL "${SRC_URL}" -o "${BUILD_DIR}/pnpm-src.tar.gz"
    echo "${SRC_SHA256}  ${BUILD_DIR}/pnpm-src.tar.gz" | sha256sum -c -
    $CURL "${NPM_URL}" -o "${BUILD_DIR}/pnpm-npm.tgz"
    echo "${NPM_SHA256}  ${BUILD_DIR}/pnpm-npm.tgz" | sha256sum -c -
    $CURL "${ITZ_URL}" -o "${BUILD_DIR}/iana-time-zone.crate"
    echo "${ITZ_SHA256}  ${BUILD_DIR}/iana-time-zone.crate" | sha256sum -c -
    tar -zxf "${BUILD_DIR}/pnpm-src.tar.gz" -C "${BUILD_DIR}"
    mkdir -p "${BUILD_DIR}/wrapper"
    tar -zxf "${BUILD_DIR}/pnpm-npm.tgz" -C "${BUILD_DIR}/wrapper"
}

do_build() {
    echo "=== build: patch + cargo ==="
    SRC="${BUILD_DIR}/pnpm-${PKG_VERSION}"

    rm -f "${SRC}/.cargo/config.toml"

    for p in "${WORK_DIR}"/patchs/0001-vendor-ohos-sign.patch \
             "${WORK_DIR}"/patchs/0002-autosign-store-elf.patch \
             "${WORK_DIR}"/patchs/0003-host-platform-openharmony.patch \
             "${WORK_DIR}"/patchs/0004-iana-time-zone-vendor.patch \
             "${WORK_DIR}"/patchs/0005-cargo-lock-ohos.patch; do
        (cd "${SRC}" && patch -p1 < "$p")
    done
    # iana-time-zone 运行时 dlopen 改写：vendor 进源码树再打
    mkdir -p "${SRC}/vendor"
    tar -zxf "${BUILD_DIR}/iana-time-zone.crate" -C "${SRC}/vendor"
    mv "${SRC}/vendor/iana-time-zone-0.1.65" "${SRC}/vendor/iana-time-zone"
    (cd "${SRC}" && patch -p1 < "${WORK_DIR}/patchs/0006-iana-time-zone-dlopen.patch")
    # toybox patch 错 header 会静默 no-op，退出码不可信，grep marker 确认
    grep -q 'ohos-sign' "${SRC}/pnpm/crates/store-dir/Cargo.toml"
    grep -q 'ohos_sign_if_needed' "${SRC}/pnpm/crates/store-dir/src/cas_file.rs"
    grep -q 'openharmony' "${SRC}/pnpm/crates/detect-libc/src/lib.rs"
    grep -q 'iana-time-zone = { path' "${SRC}/Cargo.toml"
    grep -q 'ohos-sign' "${SRC}/Cargo.lock"
    grep -q 'dlopen' "${SRC}/vendor/iana-time-zone/src/tz_ohos.rs"

    # aws-lc-sys 构建 CPU Jitter RNG 需要 -O0，superenv 会把它优化掉
    export AWS_LC_SYS_NO_JITTER_ENTROPY=1
    # cargo install 只解析 cli 子图，workspace 加了 ohos-sign 成员后
    # --locked 仍能过；cargo build 会校验全 workspace 的 lock 一致性
    (cd "${SRC}" && cargo install --locked --path pnpm/crates/cli --root "${BUILD_DIR}/cargo-root")

    BIN="${BUILD_DIR}/cargo-root/bin/pnpm"
    test -f "${BIN}"
    "${BIN}" --version

    llvm-strip --strip-all "${BIN}" -o "${BUILD_DIR}/pnpm-bin"
    binary-sign-tool sign -selfSign 1 \
        -inFile "${BUILD_DIR}/pnpm-bin" \
        -outFile "${BUILD_DIR}/pnpm-bin.signed"
    mv "${BUILD_DIR}/pnpm-bin.signed" "${BUILD_DIR}/pnpm-bin"
    chmod +x "${BUILD_DIR}/pnpm-bin"
}

do_package() {
    echo "=== package: slot + main ==="
    SLOT_DIR="${BUILD_DIR}/${SLOT_NAME}"
    rm -rf "${SLOT_DIR}"
    mkdir -p "${SLOT_DIR}"
    cp "${BUILD_DIR}/pnpm-bin" "${SLOT_DIR}/pnpm"
    chmod +x "${SLOT_DIR}/pnpm"
    cat > "${SLOT_DIR}/package.json" <<EOF
{
  "name": "@ohos-npm-ports/${SLOT_NAME}",
  "version": "${PORTS_VERSION}",
  "license": "MIT",
  "os": ["openharmony"],
  "cpu": ["arm64"],
  "repository": {
    "type": "git",
    "url": "https://github.com/ohos-npm-ports/ohos-npm-ports"
  },
  "publishConfig": {
    "executableFiles": ["./pnpm"],
    "access": "public"
  }
}
EOF

    MAIN_DIR="${BUILD_DIR}/pnpm-wrapper-${PKG_VERSION}"
    mv "${BUILD_DIR}/wrapper/package" "${MAIN_DIR}"
    (cd "${MAIN_DIR}" && patch -p1 < "${WORK_DIR}/patchs/0007-update-package-json.patch")
    (cd "${MAIN_DIR}" && patch -p1 < "${WORK_DIR}/patchs/0008-native-binary-openharmony.patch")
    grep -q '@ohos-npm-ports/pnpm' "${MAIN_DIR}/package.json"
    grep -qF '@ohos-npm-ports/pnpm-openharmony-arm64/pnpm' "${MAIN_DIR}/native-binary.mjs"
}

do_test() {
    echo "=== test: assertions ==="
    MAIN_DIR="${BUILD_DIR}/pnpm-wrapper-${PKG_VERSION}"
    SLOT_DIR="${BUILD_DIR}/${SLOT_NAME}"

    # 包名/版本断言
    node -e '
        const p = require("'"${MAIN_DIR}"'/package.json");
        if (p.name !== "@ohos-npm-ports/pnpm") throw new Error("main name: " + p.name);
        if (p.version !== "'"${PORTS_VERSION}"'") throw new Error("main version: " + p.version);
        if (p.optionalDependencies["@ohos-npm-ports/'"${SLOT_NAME}"'"] !== "'"${PORTS_VERSION}"'") throw new Error("slot ref missing");
        const s = require("'"${SLOT_DIR}"'/package.json");
        if (s.name !== "@ohos-npm-ports/'"${SLOT_NAME}"'") throw new Error("slot name: " + s.name);
        if (s.version !== "'"${PORTS_VERSION}"'") throw new Error("slot version: " + s.version);
        if (s.os[0] !== "openharmony" || s.cpu[0] !== "arm64") throw new Error("slot os/cpu");
    '

    # 二进制架构与签名
    readelf -h "${SLOT_DIR}/pnpm" | grep -q 'AArch64'
    readelf -S "${SLOT_DIR}/pnpm" | grep -q '\.codesign'
    "${SLOT_DIR}/pnpm" --version

    # loader 平台分支：openharmony 命中槽位，其他平台仍走上游包
    (cd "${MAIN_DIR}" && node --input-type=module -e '
        Object.defineProperty(process, "platform", { value: "openharmony" });
        const m = await import("./native-binary.mjs");
        const c = m.getBinCandidates();
        if (c.length !== 1 || c[0] !== "@ohos-npm-ports/pnpm-openharmony-arm64/pnpm") throw new Error("openharmony: " + JSON.stringify(c));
    ')
    for plat in linux darwin win32; do
        (cd "${MAIN_DIR}" && node --input-type=module -e '
            Object.defineProperty(process, "platform", { value: "'"$plat"'" });
            const m = await import("./native-binary.mjs");
            const c = m.getBinCandidates();
            if (c.length === 0 || !c.every((s) => s.startsWith("@pnpm/exe."))) throw new Error("'"$plat"': " + JSON.stringify(c));
        ')
    done

    # 消费冒烟：双包 npm pack 后干净工程安装，跑 install.js 链接二进制并执行
    SMOKE="${BUILD_DIR}/smoke"
    rm -rf "${SMOKE}"
    mkdir -p "${SMOKE}/pkgs-slot" "${SMOKE}/pkgs-main" "${SMOKE}/proj"
    npm pack "${SLOT_DIR}" --pack-destination "${SMOKE}/pkgs-slot" >/dev/null
    npm pack "${MAIN_DIR}" --pack-destination "${SMOKE}/pkgs-main" >/dev/null
    SLOT_TGZ=$(ls "${SMOKE}/pkgs-slot/"*.tgz)
    MAIN_TGZ=$(ls "${SMOKE}/pkgs-main/"*.tgz)
    cd "${SMOKE}/proj"
    echo '{"name":"smoke"}' > package.json
    npm install --force --ignore-scripts "${SLOT_TGZ}" "${MAIN_TGZ}" >/dev/null
    cd node_modules/@ohos-npm-ports/pnpm
    node install.js
    test -x pnpm
    head -c 4 pnpm | od -An -tx1 | grep -q '7f 45 4c 46'
    ./pnpm --version
}

do_deps
do_fetch
do_build
do_package
do_test

echo "=== done: ${BUILD_DIR}/pnpm-wrapper-${PKG_VERSION} + ${BUILD_DIR}/${SLOT_NAME} ==="
