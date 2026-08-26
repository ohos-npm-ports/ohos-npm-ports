#!/bin/sh
set -e

# Repack the official yuku-parser tgz with an OpenHarmony binding. Upstream's
# loader already has an openharmony/arm64 branch whose first candidate is
# the package-internal path '@yuku-parser/binding-openharmony-arm64/yuku-parser.node', so the repacked package
# works with no loader patch and no postinstall wiring. The binding is the
# linux-arm64-musl build (same libc/ABI family on OHOS), signed — OHOS
# refuses to dlopen unsigned ELF objects.

VERSION=0.8.3
ORIG=yuku-parser
MUSL_PKG=@yuku-parser/binding
# .node file name inside the musl binding tarball
MUSL_NODE=yuku-parser.linux-arm64-musl.node

npm pack "${ORIG}@${VERSION}" --pack-destination .
tar -zxf "yuku-parser-${VERSION}.tgz"
rm "yuku-parser-${VERSION}.tgz"
mv package "yuku-parser-0.8.3"

cd "yuku-parser-0.8.3"
patch -p1 < ../patchs/0001-update-package-json.patch

# ── fetch + sign the musl binding ─────────────────────────────────────
curl -fSL --retry 5 -o ../musl.tgz \
  "https://registry.npmmirror.com/${MUSL_PKG}-linux-arm64-musl/-/binding-linux-arm64-musl-${VERSION}.tgz"
mkdir ../musl-stage
tar -zxf ../musl.tgz -C ../musl-stage
NODE_SRC=$(find ../musl-stage -name '*.node' | head -1)
[ -n "$NODE_SRC" ] || { echo "no .node in musl tarball" >&2; exit 1; }

mkdir -p "@yuku-parser/binding-openharmony-arm64"
binary-sign-tool sign -selfSign 1 -inFile "$NODE_SRC" \
  -outFile "@yuku-parser/binding-openharmony-arm64/yuku-parser.node"
chmod +x "@yuku-parser/binding-openharmony-arm64/yuku-parser.node"
rm -rf ../musl-stage ../musl.tgz

# ── verify package contents ───────────────────────────────────────────
NAME=$(node -e "console.log(require('./package.json').name)")
[ "$NAME" = "@ohos-npm-ports/yuku-parser" ]

test -f "@yuku-parser/binding-openharmony-arm64/yuku-parser.node"
readelf -h "@yuku-parser/binding-openharmony-arm64/yuku-parser.node" | grep -q 'AArch64'
readelf -S "@yuku-parser/binding-openharmony-arm64/yuku-parser.node" | grep -q '\.codesign'
echo "OK: @ohos-npm-ports/yuku-parser repacked with openharmony-arm64 binding"

# Smoke: load the binding through the package's real loader.
node -e "const b = require('./binding.js'); console.log('loader smoke:', typeof b)" \
  || node -e "const b = require('.'); console.log('loader smoke:', typeof b)"
