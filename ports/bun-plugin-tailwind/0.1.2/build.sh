#!/bin/sh
set -e

# Repackage of upstream bun-plugin-tailwind: the published bundle inlines the
# napi-rs loader for tailwindcss-oxide, which already has an openharmony
# branch resolving ./tailwindcss-oxide.openharmony-arm64.node next to
# index.mjs — so the only native work is building that addon from the
# tailwindcss source tag matching the inlined glue (v4.1.14) and shipping it
# inside the repackaged bundle. The upstream JS is not patched at all; the
# only patched file is package.json (name/version/repository/files).

PKG_NAME=bun-plugin-tailwind
PKG_VERSION=0.1.2
PORTS_VERSION=0.1.2-1
OXIDE_VERSION=4.1.14

SHA256_BUN_PLUGIN=5a27cc0e559e731a497fee377d4dc05a67889f8acca567f2e1900f6974922d90
SHA256_TAILWINDCSS=fcc3bf81aaed7eadc1506855cf57859d28ac68b16e30d8e605bdbd7128d8c11c

RUST_VER=1.98.0
RUST_DIST_DATE=2026-08-20
RUST_DIST_SHA256=db1b3c28a89a71594e9366b952ea5b34f7f9c66c853db7c3c637e59906cfcbc0

WORK_DIR=$(pwd)
BUILD_DIR="${WORK_DIR}/build"
RUST_DIR="${WORK_DIR}/rust"

PACK_TGZ="ohos-npm-ports-${PKG_NAME}-${PORTS_VERSION}.tgz"

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' 0

do_deps() {
  echo "=== deps: brew openssl@3 zlib ==="

  # cargo from the rust dist links libssl/libcrypto/libz by unversioned
  # soname; provide them from brew.
  brew install -y openssl@3 zlib
}

do_fetch() {
  echo "=== fetch: download and unpack pinned sources ==="

  rm -rf "$BUILD_DIR"
  mkdir -p "$BUILD_DIR" "$TMP_DIR/unpack"

  curl -fsSL "https://registry.npmjs.org/${PKG_NAME}/-/${PKG_NAME}-${PKG_VERSION}.tgz" -o "$BUILD_DIR/${PKG_NAME}-${PKG_VERSION}.tgz"
  [ "$(sha256sum "$BUILD_DIR/${PKG_NAME}-${PKG_VERSION}.tgz" | awk '{print $1}')" = "$SHA256_BUN_PLUGIN" ]
  curl -fsSL "https://github.com/tailwindlabs/tailwindcss/archive/refs/tags/v${OXIDE_VERSION}.tar.gz" -o "$BUILD_DIR/tailwindcss.tar.gz"
  [ "$(sha256sum "$BUILD_DIR/tailwindcss.tar.gz" | awk '{print $1}')" = "$SHA256_TAILWINDCSS" ]

  tar -zxf "$BUILD_DIR/${PKG_NAME}-${PKG_VERSION}.tgz" -C "$TMP_DIR/unpack"
  rm "$BUILD_DIR/${PKG_NAME}-${PKG_VERSION}.tgz"
  mv "$TMP_DIR/unpack/package" "$BUILD_DIR/pkg"

  tar -zxf "$BUILD_DIR/tailwindcss.tar.gz" -C "$BUILD_DIR"
  rm "$BUILD_DIR/tailwindcss.tar.gz"
  mv "$BUILD_DIR/tailwindcss-${OXIDE_VERSION}" "$BUILD_DIR/oxide-src"

  # pristine file hashes, recorded before any patch is applied
  (cd "$BUILD_DIR/pkg" && find . -type f | sort | xargs sha256sum | sort) > "$TMP_DIR/before.sha256"
}

rust_install() {
  # Toolchain: install a pinned official rust dist for this host triple.
  # `brew install rust` is not usable here — the ci-runner's brew rust routes
  # rustup through a mirror that 404s this target (ports/prisma-engines pins
  # the same dist for the same reason).
  rm -rf "$RUST_DIR"
  curl -fsSL "https://static.rust-lang.org/dist/${RUST_DIST_DATE}/rust-${RUST_VER}-aarch64-unknown-linux-ohos.tar.gz" -o "$BUILD_DIR/rust-dist.tar.gz"
  printf '%s  %s\n' "$RUST_DIST_SHA256" "$BUILD_DIR/rust-dist.tar.gz" | sha256sum -c -
  mkdir "$BUILD_DIR/rust-extract"
  tar -zxf "$BUILD_DIR/rust-dist.tar.gz" -C "$BUILD_DIR/rust-extract" --strip-components=1
  rm "$BUILD_DIR/rust-dist.tar.gz"
  sh "$BUILD_DIR/rust-extract/install.sh" --prefix="$RUST_DIR" --disable-ldconfig \
    --components=rustc,cargo,rust-std-aarch64-unknown-linux-ohos
  rm -rf "$BUILD_DIR/rust-extract"
}

do_build() {
  echo "=== build: pinned rust dist + cargo build oxide ==="

  rust_install
  export PATH="$RUST_DIR/bin:$PATH"
  # point cargo's TLS at a real cert store (same wiring as
  # ports/prisma-engines)
  export LD_LIBRARY_PATH="$(brew --prefix openssl@3)/lib:$(brew --prefix zlib)/lib"
  export CARGO_HTTP_CAINFO="$(brew --prefix)/etc/openssl@3/cert.pem"
  rustc --version

  cd "$BUILD_DIR/oxide-src/crates/node"

  # Native napi-rs build: this host's rustc triple is already
  # aarch64-unknown-linux-ohos, so a plain cargo build for that target produces
  # the addon directly — no cross-compile toolchain wrapper. We call cargo
  # instead of `napi build --platform` because the CLI's post-build file
  # transaction publishes artifacts via hardlink, which the OpenHarmony host
  # filesystem does not support; the compile inputs and the resulting cdylib
  # are the same either way. The env-var linker override takes precedence over
  # any config-file default napi-rs would write.
  export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_OHOS_LINKER="$(command -v cc)"
  cargo build --release --target aarch64-unknown-linux-ohos
}

do_package() {
  echo "=== package: sign addon, patch manifest, npm pack ==="

  NODE_FILE_SRC="$BUILD_DIR/oxide-src/target/aarch64-unknown-linux-ohos/release/libtailwind_oxide.so"
  test -f "$NODE_FILE_SRC"

  cd "$BUILD_DIR/pkg"
  cp "$NODE_FILE_SRC" tailwindcss-oxide.openharmony-arm64.node

  llvm-strip --strip-all tailwindcss-oxide.openharmony-arm64.node
  binary-sign-tool sign -selfSign 1 -inFile tailwindcss-oxide.openharmony-arm64.node -outFile tailwindcss-oxide.openharmony-arm64.node.signed
  mv tailwindcss-oxide.openharmony-arm64.node.signed tailwindcss-oxide.openharmony-arm64.node

  # the only patch the port carries: the published manifest (delta is
  # name/version/repository/files only)
  patch -p1 < "$WORK_DIR/patchs/0001-update-package-json.patch"

  grep -q '"name": "@ohos-npm-ports/bun-plugin-tailwind"' package.json
  grep -q "\"version\": \"${PORTS_VERSION}\"" package.json

  npm pack
  test -f "$PACK_TGZ"
}

do_test() {
  echo "=== test: invariants, smoke tests, pack contents ==="

  cd "$BUILD_DIR/pkg"

  # --- hard invariant: the patch may only touch package.json; the openharmony
  # .node is the only added file; every other byte is upstream-pristine ---

  # the pack tarball sits next to the package contents; it is not part of
  # them and must not participate in the pristine-diff invariant
  (find . -type f ! -name "$PACK_TGZ" | sort | xargs sha256sum | sort) > "$TMP_DIR/after.sha256"

  ONLY_BEFORE=$(comm -23 "$TMP_DIR/before.sha256" "$TMP_DIR/after.sha256")
  ONLY_AFTER=$(comm -13 "$TMP_DIR/before.sha256" "$TMP_DIR/after.sha256")

  [ "$(printf '%s\n' "$ONLY_BEFORE" | wc -l)" -eq 1 ]
  printf '%s\n' "$ONLY_BEFORE" | grep -q '  \./package\.json$'
  [ "$(printf '%s\n' "$ONLY_AFTER" | wc -l)" -eq 2 ]
  printf '%s\n' "$ONLY_AFTER" | grep -q '  \./package\.json$'
  printf '%s\n' "$ONLY_AFTER" | grep -q '  \./tailwindcss-oxide\.openharmony-arm64\.node$'

  # --- manifest assertions ---

  [ "$(node -p 'require("./package.json").name')" = "@ohos-npm-ports/bun-plugin-tailwind" ]
  [ "$(node -p 'require("./package.json").version')" = "${PORTS_VERSION}" ]

  # --- native addon: AArch64 + codesign, real dlopen + functional scan ---

  readelf -h tailwindcss-oxide.openharmony-arm64.node | grep -q 'AArch64'
  readelf -S tailwindcss-oxide.openharmony-arm64.node | grep -q '\.codesign'

  node -e '
    const { Scanner } = require(process.cwd() + "/tailwindcss-oxide.openharmony-arm64.node");
    const scanner = new Scanner({ sources: [] });
    const candidates = scanner.scanFiles([
      { content: "<div class=\"text-red-500 flex\"></div>", extension: "html" },
    ]);
    console.log("scanFiles() candidates:", candidates);
    if (!candidates.includes("text-red-500") || !candidates.includes("flex")) {
      throw new Error("unexpected scan output: " + JSON.stringify(candidates));
    }
  '

  # --- loader wiring: openharmony branch present, other-platform branches
  # untouched, all 9 upstream binaries still shipped ---

  node --check index.mjs
  grep -q 'process\.platform === "openharmony"' index.mjs
  grep -q 'tailwindcss-oxide\.openharmony-arm64\.node' index.mjs
  grep -q 'tailwindcss-oxide\.win32-x64-msvc\.node' index.mjs
  grep -q 'tailwindcss-oxide\.linux-x64-gnu\.node' index.mjs
  [ "$(ls tailwindcss-oxide.*.node | grep -v 'openharmony-arm64' | wc -l)" -eq 9 ]

  # --- real load smoke: requireNative() runs at import time, and the wasm
  # fallback file is not shipped, so a successful import proves the openharmony
  # .node dlopen'ed. Upstream only supports bun (under node the bundle throws
  # resolving @tailwindcss/node/esm-cache-loader on every platform), so the
  # import smoke is bun-gated. ---

  if command -v bun >/dev/null 2>&1; then
    bun -e '
      import("./index.mjs").then((m) => {
        if (typeof m.default !== "object" || m.default.name !== "@tailwindcss/bun" || typeof m.default.setup !== "function") {
          throw new Error("unexpected export shape: " + typeof m.default);
        }
        console.log("bun import OK, plugin:", m.default.name);
      });
    '
  else
    echo "bun not found, skipping bun import smoke"
  fi

  # --- pack contents ---

  tar -tzf "$PACK_TGZ" | grep -q 'package/tailwindcss-oxide\.openharmony-arm64\.node'
  tar -tzf "$PACK_TGZ" | grep -q 'package/tailwindcss-oxide\.win32-x64-msvc\.node'
  echo "packed $PACK_TGZ"
}

do_deps
do_fetch
do_build
do_package
do_test
