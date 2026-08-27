#!/bin/sh
set -e

# Repack official vite-plus with an OpenHarmony binding embedded. The upstream
# loader (binding/index.cjs) already has an openharmony/arm64 branch that tries
# ./vite-plus.openharmony-arm64.node first, so the repacked package works with
# no loader patch and no postinstall wiring.
#
# Packages without an upstream openharmony binding (yuku-*, @ast-grep/napi,
# lightningcss) are redirected to the @ohos-npm-ports ports via the
# version-qualified pnpm overrides injected by 0005; the ports embed signed
# bindings, so no shim fabrication or signing happens here. Everything else
# (@oxc-parser, @oxc-resolver, @oxfmt, @oxlint, rollup, @oxc-node) ships
# official openharmony platform packages and resolves on its own.
#
# Two trees:
#   vite-plus-src/   — source tarball, only for compiling the binding
#   vite-plus-<ver>/ — official npm tgz, becomes the published package

VERSION=0.2.8
PKG=vite-plus
VITE_TASK_REV="5c1d02c750ac21c6f4cf0528062590a145e87fd1"

# setup-tools.sh only installs node/python/devel-base.
brew install -y rust git cmake
npm install -g pnpm@10

# ── 1. Source tree: build the OHOS napi binding ──────────────────────

curl -fsSL "https://github.com/voidzero-dev/${PKG}/archive/refs/tags/v${VERSION}.tar.gz" \
  -o src.tar.gz
tar -zxf src.tar.gz
rm src.tar.gz
mv "${PKG}-${VERSION}" "${PKG}-src"

cd "${PKG}-src"

patch -p1 < ../patchs/0002-remove-package-manager-pin.patch
patch -p1 < ../patchs/0003-enable-local-vite-task-patch-section.patch

export NPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS=false
export npm_config_manage_package_manager_versions=false

# Unlocks `-Z bindeps` on stable rust (fspy preload artifact deps).
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
cd -

# Fetch the pinned external repos (rolldown, vite) that pnpm-workspace
# references but the source tarball does not contain.
node packages/tools/src/index.ts sync-remote

# Redirect musl-only napi packages to the @ohos-npm-ports ports
# (version-qualified overrides; bindings inside are pre-signed).
# --no-frozen-lockfile: the injected overrides differ from the lockfile the
# source tarball ships, and CI installs run frozen by default.
patch -p1 < ../patchs/0005-add-ohos-port-overrides.patch

pnpm install --no-frozen-lockfile

pnpm build

cargo build -p vite-plus-cli --release

NODE_FILE=$(find target/release -maxdepth 1 -name '*.so' -o -name '*.dylib' | head -1)
if [ -z "$NODE_FILE" ]; then
  echo "ERROR: no .so found in target/release/" >&2
  ls -la target/release/ >&2
  exit 1
fi

cp "$NODE_FILE" ../binding.openharmony-arm64.node
chmod +x ../binding.openharmony-arm64.node

readelf -h ../binding.openharmony-arm64.node | grep -q 'AArch64'

cd ..

# ── 2. Official tgz: repack with the binding embedded ────────────────

npm pack "${PKG}@${VERSION}" --pack-destination .
tar -zxf "${PKG}-${VERSION}.tgz"
rm "${PKG}-${VERSION}.tgz"
mv package "${PKG}-${VERSION}"

cd "${PKG}-${VERSION}"
patch -p1 < ../patchs/0001-update-package-json.patch

binary-sign-tool sign -selfSign 1 \
  -inFile ../binding.openharmony-arm64.node \
  -outFile binding/vite-plus.openharmony-arm64.node
chmod +x binding/vite-plus.openharmony-arm64.node

# --- verify package contents ---

NAME=$(node -e "console.log(require('./package.json').name)")
[ "$NAME" = "@ohos-npm-ports/vite-plus" ]

grep -q "process.platform === 'openharmony'" binding/index.cjs
test -f binding/vite-plus.openharmony-arm64.node

readelf -h binding/vite-plus.openharmony-arm64.node | grep -q 'AArch64'
readelf -S binding/vite-plus.openharmony-arm64.node | grep -q '\.codesign'
echo "OK: @ohos-npm-ports/vite-plus repacked with openharmony-arm64 binding"
