#!/bin/sh
set -e

VERSION=16.3.5
PORT_VERSION=16.3.5-1
PKG=next
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$ROOT/../../.." && pwd)

# ===== deps =====
do_deps() {
  brew install -y rust
  command -v curl >/dev/null
  command -v cargo >/dev/null
  command -v binary-sign-tool >/dev/null
}

# ===== fetch =====
do_fetch() {
  rm -rf "$ROOT/src" "$ROOT/next-$VERSION" "$ROOT/next-swc-openharmony-arm64"
  mkdir -p "$ROOT/src" "$ROOT/next-swc-openharmony-arm64"

  curl -fsSL --retry 8 --retry-all-errors --retry-delay 2 \
    "https://codeload.github.com/vercel/next.js/tar.gz/refs/tags/v${VERSION}" \
    -o "$ROOT/next-source.tar.gz"
  tar -zxf "$ROOT/next-source.tar.gz" -C "$ROOT/src" --strip-components=1
  rm -f "$ROOT/next-source.tar.gz"
  rm -f "$ROOT/src/rust-toolchain.toml"

  curl -fsSL --retry 8 --retry-all-errors --retry-delay 2 \
    "https://registry.npmjs.org/${PKG}/-/${PKG}-${VERSION}.tgz" \
    -o "$ROOT/next.tgz"
  tar -zxf "$ROOT/next.tgz" -C "$ROOT"
  mv "$ROOT/package" "$ROOT/next-$VERSION"
  rm -f "$ROOT/next.tgz"
}

# ===== build =====
do_build() {
  HOST_TRIPLE=$(rustc -vV | sed -n 's/^host: //p')
  [ "$HOST_TRIPLE" = "aarch64-unknown-linux-ohos" ]
  git config --global --add safe.directory "$REPO_ROOT"

  cd "$ROOT/src"
  patch -p1 < "$ROOT/patchs/0003-turbo-tasks-fs-ohos.patch"
  grep -q "into_os_string" turbopack/crates/turbo-tasks-fs/src/disk.rs
  patch -p1 < "$ROOT/patchs/0004-openharmony-project-path.patch"
  grep -q "into_os_string" crates/next-napi-bindings/src/next_api/project.rs
  # The upstream workspace enables nightly-only optimization flags. The build
  # image uses stable rustc, so bootstrap those flags without another toolchain.
  export RUSTC_BOOTSTRAP=1
  cargo build -p next-napi-bindings --release \
    --features image-extended,tracing/release_max_level_trace
  test -f target/release/libnext_napi_bindings.so
  cp target/release/libnext_napi_bindings.so \
    "$ROOT/next-swc-openharmony-arm64/next-swc.openharmony-arm64.node"
  cd "$ROOT"
}

# ===== package =====
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
    "directory": "ports/next/16.3.5"
  },
  "os": ["openharmony"],
  "cpu": ["arm64"],
  "main": "next-swc.openharmony-arm64.node",
  "files": ["next-swc.openharmony-arm64.node"],
  "license": "MIT",
  "engines": { "node": ">= 20" },
  "publishConfig": { "access": "public" }
}
EOF
}

# ===== test =====
do_test() {
  node -e '
    const main = require("./next-16.3.5/package.json");
    const sub = require("./next-swc-openharmony-arm64/package.json");
    if (main.name !== "@ohos-npm-ports/next" || main.version !== sub.version) process.exit(1);
    if (main.optionalDependencies[sub.name] !== sub.version) process.exit(1);
  '
  grep -q "openharmony-arm64" next-16.3.5/dist/build/swc/index.js
  grep -q "@ohos-npm-ports/next-swc-openharmony-arm64" next-16.3.5/dist/build/swc/index.js
  readelf -h next-swc-openharmony-arm64/next-swc.openharmony-arm64.node | grep -q 'AArch64'
  readelf -S next-swc-openharmony-arm64/next-swc.openharmony-arm64.node | grep -q '\.codesign'
}

do_deps
do_fetch
do_build
do_package
do_test
