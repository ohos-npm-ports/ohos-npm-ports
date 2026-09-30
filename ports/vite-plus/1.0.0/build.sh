#!/bin/sh
set -e

# Repack official vite-plus with an OpenHarmony binding embedded. The upstream
# loader (binding/index.cjs) already has an openharmony/arm64 branch that tries
# ./vite-plus.openharmony-arm64.node first, so the repacked package works with
# no loader patch and no postinstall wiring.
#
# Packages without an upstream openharmony binding (yuku-*, @ast-grep/napi,
# lightningcss, oxlint-tsgolint, @parcel/watcher) are redirected to the
# @ohos-npm-ports ports via the version-qualified pnpm overrides injected by
# 0005; the ports embed signed bindings, so no shim fabrication or signing
# happens here. Everything else (@oxc-parser, @oxc-resolver, @oxfmt, @oxlint,
# rollup, @oxc-node) ships official openharmony platform packages and resolves
# on its own.
#
# Two trees:
#   vite-plus-src/   — source tarball, only for compiling the binding
#   vite-plus-<ver>/ — official npm tgz, becomes the published package

VERSION=1.0.0
PKG=vite-plus
VITE_TASK_REV="7d69d6577ecf6bd83deee32186de59918a712873"

SHA256_TGZ="c6b900370b47e39d45ab316f3df03294c5fe04cb141284d211f78e1dd8c824d1"
SHA256_SRC="2ae9ff19a0c514e55ba76f4025cead2faff67c91da7dce152c60b71a040e5192"

# The repo's rust-toolchain.toml pins a channel, but plain rustup resolves it
# to a stable release, which has no aarch64-unknown-linux-ohos target at all
# (CI: "could not download nonexistent rust version 1.98.1-...-linux-ohos").
# Name the toolchain with the ohos host triple explicitly; harmonybrew's rustup
# wrapper also forces RUSTUP_OVERRIDE_HOST_TRIPLE to the same value.
RUST_CHANNEL="nightly-2026-08-02"
RUST_TOOLCHAIN="${RUST_CHANNEL}-aarch64-unknown-linux-ohos"

# setup-tools.sh only installs node/python/devel-base.
brew install -y rustup git cmake
npm install -g pnpm@10

# ── 1. Source tree: build the OHOS napi binding ──────────────────────

curl -fsSL "https://github.com/voidzero-dev/${PKG}/archive/refs/tags/v${VERSION}.tar.gz" \
  -o src.tar.gz
echo "${SHA256_SRC}  src.tar.gz" | sha256sum -c -
tar -zxf src.tar.gz
rm src.tar.gz
mv "${PKG}-${VERSION}" "${PKG}-src"

cd "${PKG}-src"

patch -p1 < ../patchs/0002-remove-package-manager-pin.patch
if grep -q '"packageManager"' package.json; then
  echo "ERROR: 0002 did not remove packageManager" >&2
  exit 1
fi
patch -p1 < ../patchs/0003-enable-local-vite-task-patch-section.patch
if ! grep -q '^\[patch\."https://github.com/voidzero-dev/vite-task.git"\]$' Cargo.toml; then
  echo "ERROR: 0003 did not enable the vite-task [patch] section" >&2
  exit 1
fi

export NPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS=false
export npm_config_manage_package_manager_versions=false

# Keep rustup's state inside the port dir; the build runs as a throwaway user.
export RUSTUP_HOME="$(pwd)/../rustup-home"
export CARGO_HOME="$(pwd)/../cargo-home"
rustup toolchain install "$RUST_TOOLCHAIN" --profile minimal --component rust-src
export RUSTUP_TOOLCHAIN="$RUST_TOOLCHAIN"
export PATH="${RUSTUP_HOME}/toolchains/${RUST_TOOLCHAIN}/bin:${PATH}"

# Unlocks `-Z bindeps` (fspy preload artifact deps) if a stable compiler is ever
# substituted for the pinned nightly.
export RUSTC_BOOTSTRAP=1

# @napi-rs/cli builds the ohos linker/cc/ar paths from this; must be set
# before pnpm build compiles the rolldown binding. devel-base pulls in
# harmonybrew's ohos-sdk bottle; resolve via brew (the prefix is not
# necessarily under $HOME in CI containers).
if [ -z "$OHOS_SDK_NATIVE" ]; then
  SDK_DIR="$(brew --prefix)/opt/ohos-sdk"
  if [ -d "$SDK_DIR/native" ]; then
    export OHOS_SDK_NATIVE="$SDK_DIR/native"
  fi
fi

if ! curl -fsIL --max-time 8 -o /dev/null "https://index.crates.io/config.json" 2>/dev/null; then
  export CARGO_REGISTRIES_CRATES_IO_INDEX="sparse+https://rsproxy.cn/index/"
fi

VITE_TASK_DIR="../vite-task"
if [ ! -d "$VITE_TASK_DIR/.git" ]; then
  git clone https://github.com/voidzero-dev/vite-task.git "$VITE_TASK_DIR"
  cd "$VITE_TASK_DIR"
  git fetch --depth 1 origin "$VITE_TASK_REV"
  git checkout "$VITE_TASK_REV"
  cd -
fi

cd "$VITE_TASK_DIR"
patch -p1 < ../patchs/0004-fspy-ohos-exemption.patch
if [ "$(grep -c 'not(target_env = "ohos")' crates/fspy_preload_unix/src/lib.rs)" -ne 4 ]; then
  echo "ERROR: 0004 did not add the ohos exemption" >&2
  exit 1
fi
cd -

# Fetch the pinned external repos (rolldown, vite) that pnpm-workspace
# references but the source tarball does not contain.
node packages/tools/src/index.ts sync-remote

# Redirect musl-only napi packages to the @ohos-npm-ports ports
# (version-qualified overrides; bindings inside are pre-signed).
# --no-frozen-lockfile: the injected overrides differ from the lockfile the
# source tarball ships, and CI installs run frozen by default.
patch -p1 < ../patchs/0005-add-ohos-port-overrides.patch
if ! grep -q -- "- '@ohos-npm-ports/\*'" pnpm-workspace.yaml; then
  echo "ERROR: 0005 did not add the port scope to minimumReleaseAgeExclude" >&2
  exit 1
fi

pnpm install --no-frozen-lockfile

pnpm build

# 1.0.0 has no cdylib crate: the binding is produced by packages/cli's
# buildNapiBinding during the pnpm build above.
BINDING="packages/cli/binding/${PKG}.openharmony-arm64.node"
if [ ! -f "$BINDING" ]; then
  echo "ERROR: $BINDING not found after pnpm build" >&2
  ls -la packages/cli/binding/ >&2
  exit 1
fi

readelf -h "$BINDING" | grep -q 'AArch64'

cd ..

# ── 2. Official tgz: repack with the binding embedded ────────────────

npm pack "${PKG}@${VERSION}" --pack-destination .
echo "${SHA256_TGZ}  ${PKG}-${VERSION}.tgz" | sha256sum -c -
tar -zxf "${PKG}-${VERSION}.tgz"
rm "${PKG}-${VERSION}.tgz"
mv package "${PKG}-${VERSION}"

cd "${PKG}-${VERSION}"
patch -p1 < ../patchs/0001-update-package-json.patch

binary-sign-tool sign -selfSign 1 \
  -inFile ../"${PKG}-src/${BINDING}" \
  -outFile "binding/${PKG}.openharmony-arm64.node"

# --- verify package contents ---

NAME=$(node -e "console.log(require('./package.json').name)")
[ "$NAME" = "@ohos-npm-ports/vite-plus" ]

grep -q "process.platform === 'openharmony'" binding/index.cjs
grep -q "require('./${PKG}.openharmony-arm64.node')" binding/index.cjs
test -f "binding/${PKG}.openharmony-arm64.node"
test ! -x "binding/${PKG}.openharmony-arm64.node"

readelf -h "binding/${PKG}.openharmony-arm64.node" | grep -q 'AArch64'
readelf -S "binding/${PKG}.openharmony-arm64.node" | grep -q '\.codesign'
echo "OK: @ohos-npm-ports/vite-plus repacked with openharmony-arm64 binding"
