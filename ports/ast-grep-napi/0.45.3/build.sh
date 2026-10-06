#!/bin/sh
set -e

VERSION=0.45.3
SRC_SHA256=0ad252ce2535493e105bd4b2dd6db2829439732d15599825aecb0b02fc9e606f
NPM_SHA256=2d41810c4d74fbe210446a1239a4eab831b1186c37a6db8c8f095604407834d0

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"

brew install -y rust

curl -fsSL "https://github.com/ast-grep/ast-grep/archive/refs/tags/${VERSION}.tar.gz" \
  -o "ast-grep-${VERSION}.tar.gz"
echo "${SRC_SHA256}  ast-grep-${VERSION}.tar.gz" | sha256sum -c -
tar -zxf "ast-grep-${VERSION}.tar.gz"
rm "ast-grep-${VERSION}.tar.gz"

cd "ast-grep-${VERSION}"

if ! curl -fsIL --max-time 8 -o /dev/null "https://index.crates.io/config.json" 2>/dev/null; then
  export CARGO_REGISTRIES_CRATES_IO_INDEX="sparse+https://rsproxy.cn/index/"
fi

cargo build -p ast-grep-napi --release

NODE_SRC=$(find target/release -maxdepth 1 -name 'libast_grep_napi.so' | head -1)
[ -n "$NODE_SRC" ] || { echo "no napi cdylib in target/release" >&2; exit 1; }
readelf -h "$NODE_SRC" | grep -q 'AArch64'
cp "$NODE_SRC" "../ast-grep-napi.node"
cd ..

npm pack "@ast-grep/napi@${VERSION}" --pack-destination .
echo "${NPM_SHA256}  ast-grep-napi-${VERSION}.tgz" | sha256sum -c -
tar -zxf "ast-grep-napi-${VERSION}.tgz"
rm "ast-grep-napi-${VERSION}.tgz"
mv package "ast-grep-napi-${VERSION}"

cd "ast-grep-napi-${VERSION}"
for patch in ../patchs/*.patch; do
  patch -p1 < "$patch"
done
grep -q '"name": "@ohos-npm-ports/ast-grep-napi"' package.json
grep -q "\"version\": \"${VERSION}-1\"" package.json
grep -q '"ast-grep-napi.openharmony-arm64.node"' package.json
grep -q '"@ast-grep/napi-linux-arm64-gnu": "'"${VERSION}"'"' package.json
if grep -q '"prepublishOnly"' package.json; then echo "prepublishOnly still present" >&2; exit 1; fi

binary-sign-tool sign -selfSign 1 \
  -inFile "../ast-grep-napi.node" \
  -outFile "ast-grep-napi.openharmony-arm64.node"
chmod +x "ast-grep-napi.openharmony-arm64.node"

readelf -h "ast-grep-napi.openharmony-arm64.node" | grep -q 'AArch64'
readelf -S "ast-grep-napi.openharmony-arm64.node" | grep -q '\.codesign'
grep -q "process.platform === 'openharmony'" index.js
grep -q "./ast-grep-napi.openharmony-arm64.node" index.js

node -e "
  const { parse, Lang } = require('./index.js');
  const root = parse(Lang.JavaScript, 'const a = 1 + 2;').root();
  const m = root.find('\$A + \$B');
  if (!m || m.getMatch('A').text() !== '1' || m.getMatch('B').text() !== '2') throw new Error('napi smoke failed');
  console.log('loader + parse smoke OK');
"
echo "OK: @ohos-npm-ports/ast-grep-napi ${VERSION}-1"
