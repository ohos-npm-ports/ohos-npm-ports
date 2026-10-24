#!/bin/sh
set -e

PKG_NAME="vite-plus"
PKG_VERSION="1.4.0"
PORTS_VERSION="1.4.0-1"
VITE_TASK_REV="a3c087a771a116f7c60220fc72738703eb45ac2e"
BINDING="binding/${PKG_NAME}.openharmony-arm64.node"

SHA256_TGZ="52a980dbfc61a5a1b6083688232d6a28b223a6d87c500213f3c6702fe898753d"
SHA256_SRC="c1d15c0b059753878b47816329f275274dbf42f958a071e4ada79fa0f54c4152"

RUST_CHANNEL="nightly-2026-08-02"
RUST_TOOLCHAIN="${RUST_CHANNEL}-aarch64-unknown-linux-ohos"

PNPM_VERSION="10"

WORK_DIR="$(pwd)"
STAGE="${WORK_DIR}/build"
OUT="${WORK_DIR}/${PKG_NAME}-${PKG_VERSION}"
VITE_TASK_DIR="${STAGE}/vite-task"

CURL="curl -fsSL --retry 8 --retry-all-errors --connect-timeout 30 --speed-limit 10240 --speed-time 30"

do_deps() {
    echo "=== deps: brew rustup/git/cmake/openssl@3/zlib, npm pnpm ==="

    brew install -y rustup git cmake openssl@3 zlib
    npm install -g "pnpm@${PNPM_VERSION}"
}

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

do_build() {
    echo "=== build: 源树打 patch + vite-task 闸门 + 交叉编译 binding ==="

    cd "${STAGE}/src"
    patch -p1 < "${WORK_DIR}/patchs/0002-remove-package-manager-pin.patch"
    if grep -q '"packageManager"' package.json; then
        echo "ERROR: 0002 did not remove packageManager" >&2
        exit 1
    fi
    patch -p1 < "${WORK_DIR}/patchs/0003-enable-local-vite-task-patch-section.patch"
    if ! grep -q '^\[patch\."https://github.com/voidzero-dev/vite-task.git"\]$' Cargo.toml; then
        echo "ERROR: 0003 did not enable the vite-task [patch] section" >&2
        exit 1
    fi
    if grep -q '^vt = { path = ' Cargo.toml; then
        echo "ERROR: 0003 must not patch vt onto a path" >&2
        exit 1
    fi

    export NPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS=false
    export npm_config_manage_package_manager_versions=false

    export RUSTUP_HOME="${STAGE}/rustup-home"
    export CARGO_HOME="${STAGE}/cargo-home"
    rustup toolchain install "${RUST_TOOLCHAIN}" --profile minimal --component rust-src
    export RUSTUP_TOOLCHAIN="${RUST_TOOLCHAIN}"
    export PATH="${RUSTUP_HOME}/toolchains/${RUST_TOOLCHAIN}/bin:${PATH}"

    export RUSTC_BOOTSTRAP=1

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

    patch -p1 < "${WORK_DIR}/patchs/0005-add-ohos-port-overrides.patch"
    if ! grep -q -- "- '@ohos-npm-ports/\*'" pnpm-workspace.yaml; then
        echo "ERROR: 0005 did not add the port scope to minimumReleaseAgeExclude" >&2
        exit 1
    fi

    node packages/tools/src/index.ts sync-remote
    patch -p1 < "${WORK_DIR}/patchs/0007-declare-vite-typescript.patch"

    pnpm install --no-frozen-lockfile
    node "${WORK_DIR}/verify-build-deps.cjs"
    pnpm build

    test -f "packages/cli/${BINDING}" || {
        echo "ERROR: packages/cli/${BINDING} not built" >&2
        exit 1
    }
    readelf -h "packages/cli/${BINDING}" | grep -q 'AArch64'
    cargo metadata --format-version 1 --filter-platform aarch64-unknown-linux-ohos > "${STAGE}/cargo-metadata.json"
    node - "${STAGE}/cargo-metadata.json" "${VITE_TASK_DIR}" <<'NODE'
const assert = require("node:assert/strict");
const { resolve } = require("node:path");
const metadata = require(process.argv[2]);
const preload = metadata.packages.filter(p => p.name === "fspy_preload_unix");
assert.equal(preload.length, 1);
assert.equal(preload[0].manifest_path, resolve(process.argv[3], "crates/fspy_preload_unix/Cargo.toml"));
for (const name of ["fspy", "vt", "vt_path", "vt_str", "vt_workspace"]) {
  const packages = metadata.packages.filter(p => p.name === name);
  assert.ok(packages.length, name);
  assert.ok(packages.some(p => p.source?.startsWith("git+https://github.com/voidzero-dev/vite-task.git")), name);
}
const byId = new Map(metadata.packages.map(p => [p.id, p]));
for (const node of metadata.resolve.nodes) {
  const owner = byId.get(node.id);
  if (!owner.manifest_path.startsWith(process.cwd() + "/crates/")) continue;
  for (const dependency of node.deps) {
    const pkg = byId.get(dependency.pkg);
    if (!["fspy", "vt", "vt_path", "vt_str", "vt_workspace"].includes(pkg.name)) continue;
    assert.ok(pkg.source?.startsWith("git+https://github.com/voidzero-dev/vite-task.git"), pkg.name);
  }
}
console.log("OK: only preload is patched; consuming vite-task crates remain on git");
NODE
}

do_package() {
    echo "=== package: 重打包官方 tgz + 嵌入签名 binding + manifest 断言 ==="

    rm -rf "${OUT}"
    cp -a "${STAGE}/tgz" "${OUT}"
    cd "${OUT}"
    patch -p1 < "${WORK_DIR}/patchs/0001-update-package-json.patch"

    patch -p1 < "${WORK_DIR}/patchs/0006-fix-core-version.patch"
    node "${WORK_DIR}/test.js" "${OUT}"

    binary-sign-tool sign -selfSign 1 \
        -inFile "${STAGE}/src/packages/cli/${BINDING}" \
        -outFile "${BINDING}"

    node -e '
      const p = require("./package.json");
      if (p.name !== "@ohos-npm-ports/vite-plus") { console.error("bad name: " + p.name); process.exit(1); }
      if (p.version !== "1.4.0-1") { console.error("bad version: " + p.version); process.exit(1); }
      console.log("OK: manifest");
    '
}

do_test() {
    echo "=== test: ELF/签名 + loader 接线断言 ==="
    cd "${OUT}"

    readelf -h "${BINDING}" | grep -q 'AArch64'
    readelf -S "${BINDING}" | grep -q '\.codesign'
    test ! -x "${BINDING}"

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
