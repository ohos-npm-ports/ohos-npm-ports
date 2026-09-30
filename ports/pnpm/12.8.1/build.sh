#!/bin/sh
set -e

# ============================================================
# ohos-npm-ports: @ohos-npm-ports/pnpm 12.8.1-1
#
# 构建方式：
#   1. 下载 pnpm v12.8.1 源码 tag + pnpm@12.8.1 npm 包
#   2. 源码打补丁：host 平台上报 openharmony、iana-time-zone 改运行时 dlopen
#   3. cargo 构建 pnpm-cli，strip + 签名
#   4. 槽位包 @ohos-npm-ports/pnpm-openharmony-arm64 携带二进制
#   5. 主包 = 上游 npm wrapper 重打包：改名 + native-binary.mjs
#      增加 openharmony 平台分支
# ============================================================

PKG_NAME="pnpm"
PKG_VERSION="12.8.1"
PORTS_VERSION="12.8.1-1"
SLOT_NAME="pnpm-openharmony-arm64"
WORK_DIR="$(pwd)"
BUILD_DIR="${WORK_DIR}/build"

SRC_URL="https://github.com/pnpm/pnpm/archive/refs/tags/v${PKG_VERSION}.tar.gz"
SRC_SHA256="d4dabd7621113ed796d5c5acc972d6c48eea722fe83bac16ac3d9043b3dae1ae"
NPM_URL="https://registry.npmjs.org/pnpm/-/pnpm-${PKG_VERSION}.tgz"
NPM_SHA256="90762b8105e833164186b011efe5cde13841693ac8eaf784d2974a6e1c01fba3"
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
    # pristine-diff 基线：补丁只允许碰 package.json 和 native-binary.mjs
    node -e '
        const fs = require("fs"), crypto = require("crypto"), path = require("path");
        const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
            e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
        const hashes = {};
        for (const f of walk(process.argv[1]).sort()) {
            hashes[path.relative(process.argv[1], f)] =
                crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
        }
        fs.writeFileSync(process.argv[2], JSON.stringify(hashes, null, 1));
    ' "${BUILD_DIR}/wrapper/package" "${BUILD_DIR}/wrapper-pristine.json"
}

do_build() {
    echo "=== build: patch + cargo ==="
    SRC="${BUILD_DIR}/pnpm-${PKG_VERSION}"

    rm -f "${SRC}/.cargo/config.toml"

    for p in "${WORK_DIR}"/patchs/0001-host-platform-openharmony.patch \
             "${WORK_DIR}"/patchs/0002-iana-time-zone-vendor.patch \
             "${WORK_DIR}"/patchs/0003-cargo-lock-iana-time-zone.patch \
             "${WORK_DIR}"/patchs/0007-use-ohos-tempdir.patch; do
        (cd "${SRC}" && patch -p1 < "$p")
    done
    # iana-time-zone 运行时 dlopen 改写：vendor 进源码树再打
    mkdir -p "${SRC}/vendor"
    tar -zxf "${BUILD_DIR}/iana-time-zone.crate" -C "${SRC}/vendor"
    mv "${SRC}/vendor/iana-time-zone-0.1.65" "${SRC}/vendor/iana-time-zone"
    (cd "${SRC}" && patch -p1 < "${WORK_DIR}/patchs/0004-iana-time-zone-dlopen.patch")
    # toybox patch 错 header 会静默 no-op，退出码不可信，grep marker 确认
    grep -q 'openharmony' "${SRC}/pnpm/crates/detect-libc/src/lib.rs"
    grep -q 'iana-time-zone = { path' "${SRC}/Cargo.toml"
    ! grep -q 'e31bc9ad994ba00e440a8aa5c9ef0ec67d5cb5e5cb0cc7f8b744a35b389cc470' \
        "${SRC}/Cargo.lock"
    grep -q 'dlopen' "${SRC}/vendor/iana-time-zone/src/tz_ohos.rs"
    # 0007: store 操作锁的根目录。pnpm 在 secure_user_lock_dir 里硬编码 /tmp
    # （刻意不读 TMPDIR，让不同 TMPDIR 的进程仍共享同一把锁），而 OHOS 的
    # /tmp 只读，于是 install 报 ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK。
    grep -q 'OHOS_TEMP_DIR: &str = "/data/storage/el2/base/cache"' \
        "${SRC}/pnpm/crates/fs/src/secure_temp_lock.rs"

    # aws-lc-sys 构建 CPU Jitter RNG 需要 -O0，superenv 会把它优化掉
    export AWS_LC_SYS_NO_JITTER_ENTROPY=1
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
    (cd "${MAIN_DIR}" && patch -p1 < "${WORK_DIR}/patchs/0005-update-package-json.patch")
    (cd "${MAIN_DIR}" && patch -p1 < "${WORK_DIR}/patchs/0006-native-binary-openharmony.patch")
    grep -q '@ohos-npm-ports/pnpm' "${MAIN_DIR}/package.json"
    grep -qF '@ohos-npm-ports/pnpm-openharmony-arm64/pnpm' "${MAIN_DIR}/native-binary.mjs"

    # pristine-diff 不变量：组装产物与上游解包逐字节一致，
    # 唯一允许改写的文件是两个 patch 的载体
    node -e '
        const fs = require("fs"), crypto = require("crypto"), path = require("path");
        const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
            e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
        const current = {};
        for (const f of walk(process.argv[1]).sort()) {
            current[path.relative(process.argv[1], f)] =
                crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
        }
        const pristine = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
        const allowed = new Set(["package.json", "native-binary.mjs"]);
        for (const k of new Set([...Object.keys(pristine), ...Object.keys(current)])) {
            if (pristine[k] !== current[k] && !allowed.has(k)) {
                throw new Error("wrapper drift beyond patched files: " + k);
            }
        }
    ' "${MAIN_DIR}" "${BUILD_DIR}/wrapper-pristine.json"
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

    # 真正跑一次 install：0007 修的锁目录问题只有执行才会暴露。
    # 未打 0007 时这里报 ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK（/tmp 只读）。
    (cd "${SMOKE}/proj" && ./node_modules/@ohos-npm-ports/pnpm/pnpm install --lockfile-only)

    # publish.sh 的 cd 目标即发布契约；PR 阶段 CI 跑不到 publish，这里降级成断言
    test -d "${WORK_DIR}/build/${SLOT_NAME}"
    test -d "${WORK_DIR}/build/pnpm-wrapper-${PKG_VERSION}"
}

do_deps
do_fetch
do_build
do_package
do_test

echo "=== done: ${BUILD_DIR}/pnpm-wrapper-${PKG_VERSION} + ${BUILD_DIR}/${SLOT_NAME} ==="
