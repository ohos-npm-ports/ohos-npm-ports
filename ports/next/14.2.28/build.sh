#!/bin/sh
set -e

VERSION=14.2.28
PORT_VERSION=14.2.28-1
PKG=next
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$ROOT/../../.." && pwd)

do_deps() {
  brew install -y rust
  command -v curl >/dev/null
  command -v cargo >/dev/null
  command -v binary-sign-tool >/dev/null
}

do_fetch() {
  if [ -d "$ROOT/src/target" ]; then
    rm -rf "$ROOT/target-cache"
    mv "$ROOT/src/target" "$ROOT/target-cache"
  fi
  rm -rf "$ROOT/src" "$ROOT/next-$VERSION" "$ROOT/next-swc-openharmony-arm64"
  mkdir -p "$ROOT/src" "$ROOT/next-swc-openharmony-arm64"

  curl -fsSL --retry 8 --retry-all-errors --retry-delay 2 \
    "https://codeload.github.com/vercel/next.js/tar.gz/refs/tags/v${VERSION}" \
    -o "$ROOT/next-source.tar.gz"
  printf '%s  %s\n' \
    91d591766dab80ed739e9a45a34252bd069089fe72dde745e0cc72ca082a28d2 \
    "$ROOT/next-source.tar.gz" | sha256sum -c -
  tar -zxf "$ROOT/next-source.tar.gz" -C "$ROOT/src" --strip-components=1
  rm -f "$ROOT/src/rust-toolchain.toml" "$ROOT/src/rust-toolchain"
  cd "$ROOT/src"
  patch -p1 < "$ROOT/patchs/0015-next-core-arbitrary-self-types.patch"
  patch -p1 < "$ROOT/patchs/0016-next-api-arbitrary-self-types.patch"
  patch -p1 < "$ROOT/patchs/0017-next-napi-arbitrary-self-types.patch"
  if [ -d "$ROOT/target-cache" ]; then
    mv "$ROOT/target-cache" "$ROOT/src/target"
  fi
  cd "$ROOT"

  curl -fsSL --retry 8 --retry-all-errors --retry-delay 2 \
    "https://registry.npmjs.org/${PKG}/-/${PKG}-${VERSION}.tgz" \
    -o "$ROOT/next.tgz"
  printf '%s  %s\n' \
    3e35deced0ce28c847706d87c3a1d4f4237cdf9b83bbba2fcf0e346f5d863381 \
    "$ROOT/next.tgz" | sha256sum -c -
  tar -zxf "$ROOT/next.tgz" -C "$ROOT"
  mv "$ROOT/package" "$ROOT/next-$VERSION"
  rm -f "$ROOT/next.tgz" "$ROOT/next-source.tar.gz"
}

do_build() {
  HOST_TRIPLE=$(rustc -vV | sed -n 's/^host: //p')
  [ "$HOST_TRIPLE" = "aarch64-unknown-linux-ohos" ]
  git config --global --add safe.directory "$REPO_ROOT"

  cd "$ROOT/src"
  export RUSTC_BOOTSTRAP=1
  CARGO_ENCODED_RUSTFLAGS= cargo fetch --target "$HOST_TRIPLE"
  CARGO_HOME=${CARGO_HOME:-"$HOME/.cargo"}
  TURBO_CHECKOUT=$(find "$CARGO_HOME/git/checkouts" -type d \
    -path '*/385f270' -print -quit)
  [ -n "$TURBO_CHECKOUT" ]
  if grep -q 'feature(hash_raw_entry)' \
    "$TURBO_CHECKOUT/crates/turbo-tasks-auto-hash-map/src/lib.rs"; then
    cd "$TURBO_CHECKOUT"
    patch -p1 < "$ROOT/patchs/0007-turbo-raw-entry-stable.patch"
  fi
  ! grep -q 'feature(hash_raw_entry)' \
    "$TURBO_CHECKOUT/crates/turbo-tasks-auto-hash-map/src/lib.rs"
  if ! grep -q 'feature(arbitrary_self_types_pointers)' \
    "$TURBO_CHECKOUT/crates/turbo-tasks/src/lib.rs"; then
    cd "$TURBO_CHECKOUT"
    patch -p1 < "$ROOT/patchs/0009-turbo-arbitrary-self-types.patch"
  fi
  grep -q 'feature(arbitrary_self_types_pointers)' \
    "$TURBO_CHECKOUT/crates/turbo-tasks/src/lib.rs"
  if ! grep -q 'feature(arbitrary_self_types_pointers)' \
    "$TURBO_CHECKOUT/crates/turbo-tasks-fs/src/lib.rs"; then
    cd "$TURBO_CHECKOUT"
    patch -p1 < "$ROOT/patchs/0010-turbo-arbitrary-self-types-crates.patch"
  fi
  grep -q 'feature(arbitrary_self_types_pointers)' \
    "$TURBO_CHECKOUT/crates/turbo-tasks-fs/src/lib.rs"
  if ! grep -q 'feature(arbitrary_self_types_pointers)' \
    "$TURBO_CHECKOUT/crates/turbopack-core/src/lib.rs"; then
    cd "$TURBO_CHECKOUT"
    patch -p1 < "$ROOT/patchs/0012-turbo-arbitrary-self-types-all.patch"
  fi
  grep -q 'feature(arbitrary_self_types_pointers)' \
    "$TURBO_CHECKOUT/crates/turbopack-core/src/lib.rs"
  if ! grep -q 'define_opaque(ChunkItemToGraphNodesEdges' \
    "$TURBO_CHECKOUT/crates/turbopack-core/src/chunk/mod.rs"; then
    cd "$TURBO_CHECKOUT"
    patch -p1 < "$ROOT/patchs/0011-turbopack-define-opaque.patch"
  fi
  grep -q 'define_opaque(ChunkItemToGraphNodesEdges' \
    "$TURBO_CHECKOUT/crates/turbopack-core/src/chunk/mod.rs"
  if grep -q 'feature(array_chunks)' \
    "$TURBO_CHECKOUT/crates/turbopack-dev-server/src/lib.rs"; then
    cd "$TURBO_CHECKOUT"
    patch -p1 < "$ROOT/patchs/0013-remove-stable-array-chunks.patch"
  fi
  ! grep -q 'feature(array_chunks)' \
    "$TURBO_CHECKOUT/crates/turbopack-dev-server/src/lib.rs"
  if grep -q '.extract_if(|field|' \
    "$TURBO_CHECKOUT/crates/turbopack-node/src/transforms/webpack.rs"; then
    cd "$TURBO_CHECKOUT"
    patch -p1 < "$ROOT/patchs/0014-turbo-vec-extract-if.patch"
  fi
  ! grep -q '.extract_if(|field|' \
    "$TURBO_CHECKOUT/crates/turbopack-node/src/transforms/webpack.rs"
  cd "$ROOT/src"
  if ! grep -A8 'name = "auto-hash-map"' Cargo.lock | \
    grep -q 'hashbrown 0.14.3'; then
    patch -p1 < "$ROOT/patchs/0008-turbo-hashbrown-lock.patch"
  fi
  CARGO_ENCODED_RUSTFLAGS= cargo fetch --target "$HOST_TRIPLE"
  INCLUDE_DIR_MACROS=$(find "$CARGO_HOME/registry/src" -type d \
    -name include_dir_macros-0.7.3 -print -quit)
  [ -n "$INCLUDE_DIR_MACROS" ]
  if grep -q 'proc_macro::tracked_env::var' "$INCLUDE_DIR_MACROS/src/lib.rs"; then
    cd "$INCLUDE_DIR_MACROS"
    patch -p1 < "$ROOT/patchs/0003-stable-include-dir-macros.patch"
  fi
  ! grep -q 'proc_macro::tracked_env::var' "$INCLUDE_DIR_MACROS/src/lib.rs"
  ! grep -q 'proc_macro::tracked_path::path' "$INCLUDE_DIR_MACROS/src/lib.rs"
  TARGET_LEXICON=$(find "$CARGO_HOME/registry/src" -type d \
    -name target-lexicon-0.12.6 -print -quit)
  [ -n "$TARGET_LEXICON" ]
  if ! grep -q 'aarch64-unknown-linux-ohos' "$TARGET_LEXICON/build.rs"; then
    cd "$TARGET_LEXICON"
    patch -p1 < "$ROOT/patchs/0004-target-lexicon-openharmony-host.patch"
  fi
  grep -q 'aarch64-unknown-linux-ohos' "$TARGET_LEXICON/build.rs"
  TIME_CRATE=$(find "$CARGO_HOME/registry/src" -type d \
    -name time-0.3.30 -print -quit)
  [ -n "$TIME_CRATE" ]
  if grep -q 'collect::<Result<Box<_>, _>>()?' \
    "$TIME_CRATE/src/format_description/parse/mod.rs"; then
    cd "$TIME_CRATE"
    patch -p1 < "$ROOT/patchs/0005-time-rust-compat.patch"
  fi
  ! grep -q 'collect::<Result<Box<_>, _>>()?' \
    "$TIME_CRATE/src/format_description/parse/mod.rs"
  SOCKET2=$(find "$CARGO_HOME/registry/src" -type d \
    -name socket2-0.4.9 -print -quit)
  [ -n "$SOCKET2" ]
  if ! sed -n '220,250p' "$SOCKET2/src/sys/unix.rs" | \
    grep -q 'target_env = "ohos"'; then
    cd "$SOCKET2"
    patch -p1 < "$ROOT/patchs/0006-socket2-ohos-iovlen.patch"
  fi
  sed -n '220,250p' "$SOCKET2/src/sys/unix.rs" | \
    grep -q 'target_env = "ohos"'
  cd "$ROOT/src"
  export CARGO_TARGET_DIR="$ROOT/src/target"
  cargo build -p next-swc-napi --release \
    --features plugin,image-extended,tracing/release_max_level_info
  test -f "$CARGO_TARGET_DIR/release/libnext_swc_napi.so"
  cp "$CARGO_TARGET_DIR/release/libnext_swc_napi.so" \
    "$ROOT/next-swc-openharmony-arm64/next-swc.openharmony-arm64.node"
  cd "$ROOT"
}

do_package() {
  llvm-strip --strip-all \
    next-swc-openharmony-arm64/next-swc.openharmony-arm64.node
  binary-sign-tool sign -selfSign 1 \
    -inFile next-swc-openharmony-arm64/next-swc.openharmony-arm64.node \
    -outFile next-swc-openharmony-arm64/next-swc.openharmony-arm64.node.signed
  mv next-swc-openharmony-arm64/next-swc.openharmony-arm64.node.signed \
    next-swc-openharmony-arm64/next-swc.openharmony-arm64.node
  chmod +x next-swc-openharmony-arm64/next-swc.openharmony-arm64.node

  cd "$ROOT/next-$VERSION"
  patch -p1 < "$ROOT/patchs/0001-openharmony-loader.patch"
  patch -p1 < "$ROOT/patchs/0002-package-json.patch"
  cd "$ROOT"

  cat > next-swc-openharmony-arm64/package.json <<EOF
{
  "name": "@ohos-npm-ports/next-swc-openharmony-arm64",
  "version": "${PORT_VERSION}",
  "description": "OpenHarmony arm64 native SWC binding for Next.js",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/ohos-npm-ports/ohos-npm-ports.git",
    "directory": "ports/next/14.2.28"
  },
  "os": ["openharmony"],
  "cpu": ["arm64"],
  "main": "next-swc.openharmony-arm64.node",
  "files": ["next-swc.openharmony-arm64.node"],
  "license": "MIT",
  "engines": { "node": ">=18.17.0" },
  "publishConfig": { "access": "public" }
}
EOF
}

do_test() {
  node -e '
    const main = require("./next-14.2.28/package.json");
    const sub = require("./next-swc-openharmony-arm64/package.json");
    if (main.name !== "@ohos-npm-ports/next" || main.version !== sub.version) process.exit(1);
    if (main.optionalDependencies[sub.name] !== sub.version) process.exit(1);
  '
  grep -q "openharmony-arm64" next-14.2.28/dist/build/swc/index.js
  grep -q "@ohos-npm-ports/next-swc-openharmony-arm64" next-14.2.28/dist/build/swc/index.js
  readelf -h next-swc-openharmony-arm64/next-swc.openharmony-arm64.node | grep -q 'AArch64'
  readelf -S next-swc-openharmony-arm64/next-swc.openharmony-arm64.node | grep -q '\.codesign'
}

do_deps
do_fetch
do_build
do_package
do_test
sh "$ROOT/smoke.sh"
