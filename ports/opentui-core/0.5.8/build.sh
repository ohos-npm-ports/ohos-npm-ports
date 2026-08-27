#!/bin/sh
set -e

# libopentui.so: zig 0.16.0 交叉编译 aarch64-linux-musl（同官方
# @opentui/core-linux-arm64-musl target，musl 动态库签名后真机 dlopen 已验证）。
# JS bundle 沿用官方 npm 包，openharmony 分支由 0002 patch 注入 loader。

VERSION=0.5.8
PKG=opentui-core
ZIG_VERSION=0.16.0
ZIG_SHA256=ea4b09bfb22ec6f6c6ceac57ab63efb6b46e17ab08d21f69f3a48b38e1534f17
ROOT="$(pwd)"

# Large downloads intermittently stall or die mid-transfer on some networks.
CURL="curl -fsSL --retry 8 --retry-all-errors --connect-timeout 30 --speed-limit 10240 --speed-time 30"

$CURL "https://registry.npmjs.org/@opentui/core/-/core-${VERSION}.tgz" -o core.tgz
tar -zxf core.tgz
rm core.tgz
mv package "${PKG}-${VERSION}"

$CURL "https://codeload.github.com/anomalyco/opentui/tar.gz/refs/tags/v${VERSION}" \
  -o "opentui-${VERSION}.tar.gz"
tar -zxf "opentui-${VERSION}.tar.gz"
rm "opentui-${VERSION}.tar.gz"

# zig 版本对齐上游 build-core.yml 的 ZIG_VERSION pin
curl -fsSL --retry 8 --retry-all-errors --connect-timeout 30 --speed-limit 10240 --speed-time 30 -o zig.tar.xz \
  "https://ziglang.org/download/${ZIG_VERSION}/zig-aarch64-linux-${ZIG_VERSION}.tar.xz"
echo "${ZIG_SHA256}  zig.tar.xz" | sha256sum -c -
tar -xJf zig.tar.xz
rm zig.tar.xz
ZIG="${ROOT}/zig-aarch64-linux-${ZIG_VERSION}/zig"
# default cache dir path differs between CI containers and OHOS hosts.
export ZIG_GLOBAL_CACHE_DIR="${ROOT}/zig-cache"

cd "${ROOT}/opentui-${VERSION}"
patch -p1 < ../patchs/0003-ohos-weak-pthread-tryjoin.patch

cd "${ROOT}/opentui-${VERSION}/packages/native"
sh scripts/prepare-zig-deps.sh
"${ZIG}" build -Dlibrary-target=aarch64-linux-musl -Doptimize=ReleaseFast

LIB="lib/aarch64-linux-musl/libopentui.so"
[ -f "$LIB" ] || { echo "no libopentui.so under lib/aarch64-linux-musl" >&2; exit 1; }
readelf -h "$LIB" | grep -q 'AArch64'
cp "$LIB" "${ROOT}/${PKG}-${VERSION}/libopentui.so"

cd "${ROOT}/${PKG}-${VERSION}"
patch -p1 < ../patchs/0001-update-package-json.patch
patch -p1 < ../patchs/0002-openharmony-loader.patch

# zig's bundled LLD lacks the CodeSign patch, so sign explicitly.
llvm-strip --strip-all libopentui.so
binary-sign-tool sign -selfSign 1 -inFile libopentui.so -outFile libopentui.so.signed
mv libopentui.so.signed libopentui.so
chmod +x libopentui.so

NAME=$(node -e "console.log(require('./package.json').name)")
[ "$NAME" = "@ohos-npm-ports/opentui-core" ]

for f in *.js; do
  node --check "$f"
done

for f in chunk-bun-2956gvaq.js chunk-node-mfda59vq.js; do
  grep -q 'openharmony: "libopentui.so"' "$f"
  grep -q 'process.platform === "openharmony"' "$f"
done

readelf -h libopentui.so | grep -q 'AArch64'
readelf -S libopentui.so | grep -q '\.codesign'

readelf --dyn-syms libopentui.so | grep 'pthread_tryjoin_np' | grep -q ' WEAK '

# npm alias override makes bare "@opentui/core" self-imports unresolvable.
if grep -rnE '(from|import\(|require\()"@opentui/core["/]' *.js; then
  echo "Bare @opentui/core self-import found (breaks npm alias override resolution)" >&2
  exit 1
fi

# optionalDependencies must track upstream's base version, not our -N suffix.
node -e '
  const pkg = require("./package.json");
  const base = pkg.version.replace(/-.*$/, "");
  for (const [name, range] of Object.entries(pkg.optionalDependencies ?? {})) {
    if (name.startsWith("@opentui/core-") && range !== base) {
      console.error(`optionalDependencies["${name}"] = ${range}, expected ${base}`);
      process.exit(1);
    }
  }
'

python3 -c "
import ctypes
ctypes.CDLL('./libopentui.so')
print('libopentui.so dlopen: OK')
"

echo "OK: @ohos-npm-ports/opentui-core ${VERSION}-1 repacked with source-built core"
