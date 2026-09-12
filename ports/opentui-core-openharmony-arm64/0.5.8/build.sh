#!/bin/sh
set -e

# 源码构建 libopentui.so（zig aarch64-linux-musl，同官方
# @opentui/core-linux-arm64-musl target），OHOS musl 无 pthread_tryjoin_np，
# 0003 以 weak 符号回退（缺符号解析为 null 走回退路径）。
# 消费方以 optionalDependencies alias 安装到上游槽位名
# @opentui/core-openharmony-arm64：父包解析分支按上游平台包命名约定引用本包；
# bun --compile 时消费方 bundler 经本包 index.bun.js 的字面量 file-import 内嵌 .so。
# index.* 模板与上游 packages/core/scripts/build.ts --native 的平台包产物逐字一致。
# 分区同构 brew 内部流水线：deps → fetch → build → package → test。

# ============================== 声明 ==============================

unset LD_PRELOAD

VERSION=0.5.8
PKG=opentui-core-openharmony-arm64
PKG_VERSION="${VERSION}-1"
ZIG_VERSION=0.16.0
ZIG_SHA256=ea4b09bfb22ec6f6c6ceac57ab63efb6b46e17ab08d21f69f3a48b38e1534f17
ROOT="$(pwd)"
PORT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SRC="opentui-${VERSION}"
PKG_DIR="${PKG}-${VERSION}"
NATIVE_LIB="${SRC}/packages/native/lib/aarch64-linux-musl/libopentui.so"

CURL="curl -fsSL --retry 8 --retry-all-errors --connect-timeout 30 --speed-limit 10240 --speed-time 30"

# ============================== deps ==============================

do_deps() {
  $CURL "https://ziglang.org/download/${ZIG_VERSION}/zig-aarch64-linux-${ZIG_VERSION}.tar.xz" -o zig.tar.xz
  echo "${ZIG_SHA256}  zig.tar.xz" | sha256sum -c -
  tar -xJf zig.tar.xz
  rm zig.tar.xz
  chmod +x "zig-aarch64-linux-${ZIG_VERSION}/zig"
  export ZIG_GLOBAL_CACHE_DIR="${ROOT}/zig-cache"
}

# ============================== fetch ==============================

do_fetch() {
  $CURL "https://codeload.github.com/anomalyco/opentui/tar.gz/refs/tags/v${VERSION}" \
    -o "${SRC}.tar.gz"
  tar -zxf "${SRC}.tar.gz"
  rm "${SRC}.tar.gz"
}

# ============================== build ==============================

do_build() {
  cd "${ROOT}/${SRC}"
  patch -p1 < "${PORT_DIR}/patchs/0003-ohos-weak-pthread-tryjoin.patch"
  # toybox patch 对错 header 静默 no-op，打完必须 grep marker
  grep -q 'linkage = .weak' packages/native/src/clipboard/host.zig

  cd "${ROOT}/${SRC}/packages/native"
  sh scripts/prepare-zig-deps.sh
  "${ROOT}/zig-aarch64-linux-${ZIG_VERSION}/zig" build -Dlibrary-target=aarch64-linux-musl -Doptimize=ReleaseFast
  [ -f "${ROOT}/${NATIVE_LIB}" ] || { echo "no libopentui.so under lib/aarch64-linux-musl" >&2; exit 1; }
  readelf -h "${ROOT}/${NATIVE_LIB}" | grep -q 'AArch64'
}

# ============================== package ==============================

do_package() {
  # 随包发布给用户的 .so：llvm-strip + 签名（dlopen 库无需 +x）
  llvm-strip --strip-all "${ROOT}/${NATIVE_LIB}"
  binary-sign-tool sign -selfSign 1 -inFile "${ROOT}/${NATIVE_LIB}" -outFile "${ROOT}/${NATIVE_LIB}.signed"
  mv "${ROOT}/${NATIVE_LIB}.signed" "${ROOT}/${NATIVE_LIB}"
  readelf -S "${ROOT}/${NATIVE_LIB}" | grep -q '\.codesign'

  mkdir -p "${ROOT}/${PKG_DIR}"
  cd "${ROOT}/${PKG_DIR}"
  cat > index.js <<'EOF'
import { fileURLToPath } from "node:url"

export default fileURLToPath(new URL("./libopentui.so", import.meta.url))
EOF
  cat > index.bun.js <<'EOF'
const module = await import("./libopentui.so", { with: { type: "file" } })

export default module.default
EOF
  cat > index.d.ts <<'EOF'
declare const path: string
export default path
EOF
  cat > package.json <<EOF
{
  "name": "@ohos-npm-ports/${PKG}",
  "version": "${PKG_VERSION}",
  "description": "Prebuilt openharmony-arm64 binaries for @opentui/core",
  "type": "module",
  "main": "index.js",
  "module": "index.js",
  "types": "index.d.ts",
  "license": "MIT",
  "author": "OpenTUI Contributors",
  "repository": {
    "type": "git",
    "url": "https://github.com/ohos-npm-ports/ohos-npm-ports",
    "directory": "ports/${PKG}/${VERSION}"
  },
  "exports": {
    ".": {
      "bun": "./index.bun.js",
      "import": "./index.js",
      "types": "./index.d.ts"
    }
  },
  "os": ["openharmony"],
  "cpu": ["arm64"]
}
EOF
  cp "${ROOT}/${NATIVE_LIB}" libopentui.so
  cp "${ROOT}/${SRC}/LICENSE" LICENSE
  cd "${ROOT}/${SRC}/packages/native/src/vendor"
  cp wuffs/LICENSE   "${ROOT}/${PKG_DIR}/LICENSE-WUFFS"
  cp stb/LICENSE     "${ROOT}/${PKG_DIR}/LICENSE-STB"
  cp libwebp/COPYING "${ROOT}/${PKG_DIR}/LICENSE-LIBWEBP"
  cp libwebp/PATENTS "${ROOT}/${PKG_DIR}/PATENTS-LIBWEBP"
  cp libwebp/AUTHORS "${ROOT}/${PKG_DIR}/AUTHORS-LIBWEBP"
  cp lcms2/LICENSE   "${ROOT}/${PKG_DIR}/LICENSE-LCMS2"
  cp "${ROOT}/${SRC}/packages/core/THIRD_PARTY_LICENSES/GHOSTTY" \
     "${ROOT}/${PKG_DIR}/LICENSE-GHOSTTY"
}

# ============================== test ==============================

do_test() {
  cd "${ROOT}/${PKG_DIR}"
  NAME=$(node -e "console.log(require('./package.json').name)")
  [ "$NAME" = "@ohos-npm-ports/${PKG}" ]
  node -e '
    const pkg = require("./package.json");
    if (pkg.os[0] !== "openharmony" || pkg.cpu[0] !== "arm64") {
      console.error("os/cpu filter wrong"); process.exit(1);
    }
  '
  readelf -h libopentui.so | grep -q 'AArch64'
  readelf -S libopentui.so | grep -q '\.codesign'
  readelf --dyn-syms libopentui.so | grep 'pthread_tryjoin_np' | grep -q ' WEAK '
  python3 -c "import ctypes; ctypes.CDLL('./libopentui.so'); print('dlopen OK')"
}

# ============================== 执行（deps → fetch → build → package → test） ==============================

do_deps
do_fetch
do_build
do_package
do_test

echo "OK: @ohos-npm-ports/${PKG} ${PKG_VERSION} packed with source-built core"
