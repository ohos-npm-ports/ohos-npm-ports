#!/bin/sh
set -e

# Repack the official @napi-rs/lzma tgz with an OpenHarmony binding. Upstream's
# loader already has an openharmony/arm64 branch whose first candidate is
# the package-internal path 'lzma.openharmony-arm64.node', so the repacked package
# works with no loader patch and no postinstall wiring. The binding is the
# linux-arm64-musl build (same libc/ABI family on OHOS), signed — OHOS
# refuses to dlopen unsigned ELF objects.

VERSION=1.4.5
ORIG=@napi-rs/lzma
MUSL_PKG=@napi-rs/lzma
# .node file name inside the musl binding tarball
MUSL_NODE=lzma.linux-arm64-musl.node

npm pack "${ORIG}@${VERSION}" --pack-destination .
tar -zxf "napi-rs-lzma-${VERSION}.tgz"
rm "napi-rs-lzma-${VERSION}.tgz"
mv package "napi-rs-lzma-1.4.5"

cd "napi-rs-lzma-1.4.5"
patch -p1 < ../patchs/0001-update-package-json.patch

# ── fetch + sign the musl binding ─────────────────────────────────────
curl -fSL --retry 5 -o ../musl.tgz \
  "https://registry.npmmirror.com/${MUSL_PKG}-linux-arm64-musl/-/lzma-linux-arm64-musl-${VERSION}.tgz"
mkdir ../musl-stage
tar -zxf ../musl.tgz -C ../musl-stage
NODE_SRC=$(find ../musl-stage -name '*.node' | head -1)
[ -n "$NODE_SRC" ] || { echo "no .node in musl tarball" >&2; exit 1; }

mkdir -p "."
binary-sign-tool sign -selfSign 1 -inFile "$NODE_SRC" \
  -outFile "lzma.openharmony-arm64.node"
chmod +x "lzma.openharmony-arm64.node"
rm -rf ../musl-stage ../musl.tgz

# ── verify package contents ───────────────────────────────────────────
NAME=$(node -e "console.log(require('./package.json').name)")
[ "$NAME" = "@ohos-npm-ports/napi-rs-lzma" ]

test -f "lzma.openharmony-arm64.node"
readelf -h "lzma.openharmony-arm64.node" | grep -q 'AArch64'
readelf -S "lzma.openharmony-arm64.node" | grep -q '\.codesign'
echo "OK: @ohos-npm-ports/napi-rs-lzma repacked with openharmony-arm64 binding"

# Smoke: load the binding through the package's real loader.
node -e "const b = require('./binding.js'); console.log('loader smoke:', typeof b)" \
  || node -e "const b = require('.'); console.log('loader smoke:', typeof b)"
