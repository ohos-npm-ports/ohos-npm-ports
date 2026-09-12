#!/bin/sh
set -e

# JS bundle 用上游同版本 bun 从 v0.5.8 源码重建（0002 在 src 层注入 openharmony
# 分支），官方构建产物零改动；native 不随父包发布，由平台槽位包
# @opentui/core-openharmony-arm64（ports/opentui-core-openharmony-arm64/0.5.8）
# 经 optionalDependencies npm alias 提供，bun --compile 消费时由消费方 bundler
# 经槽位包内嵌 libopentui.so。
# 分区同构 brew 内部流水线：deps（工具链）→ fetch（物料+sha256）→ build（补丁+
# 构建+拼接）→ package（发布形态收尾）→ test（静态断言 + e2e 真跑）。

# ============================== 声明 ==============================

unset LD_PRELOAD

VERSION=0.5.8
PKG=opentui-core
SLOT_VERSION="${VERSION}-1"
ZIG_VERSION=0.16.0
ZIG_SHA256=ea4b09bfb22ec6f6c6ceac57ab63efb6b46e17ab08d21f69f3a48b38e1534f17
ROOT="$(pwd)"
PORT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SRC="opentui-${VERSION}"
PKG_DIR="${PKG}-${VERSION}"
DIST="${SRC}/packages/core/dist"
NATIVE_LIB="${SRC}/packages/native/lib/aarch64-linux-musl/libopentui.so"

CURL="curl -fsSL --retry 8 --retry-all-errors --connect-timeout 30 --speed-limit 10240 --speed-time 30"

# ============================== deps ==============================

do_deps() {
  # bun：harmonybrew bottle；bottle PT_INTERP 指 /system/lib（真机布局），CI 容器 loader 在 /lib
  if ! command -v bun >/dev/null 2>&1; then
    brew tap social4hyq/core https://atomgit.com/social4hyq/homebrew-core.git
    brew install -y social4hyq/core/bun
  fi
  if [ ! -e /system/lib/ld-musl-aarch64.so.1 ] && [ -e /lib/ld-musl-aarch64.so.1 ]; then
    mkdir -p /system/lib
    ln -s /lib/ld-musl-aarch64.so.1 /system/lib/ld-musl-aarch64.so.1
  fi
  bun --version

  # zig：仅 e2e 冒烟脚手架使用（构建期产物，不签名）
  $CURL "https://ziglang.org/download/${ZIG_VERSION}/zig-aarch64-linux-${ZIG_VERSION}.tar.xz" -o zig.tar.xz
  echo "${ZIG_SHA256}  zig.tar.xz" | sha256sum -c -
  tar -xJf zig.tar.xz
  rm zig.tar.xz
  chmod +x "zig-aarch64-linux-${ZIG_VERSION}/zig"
  export ZIG_GLOBAL_CACHE_DIR="${ROOT}/zig-cache"
}

# ============================== fetch ==============================

do_fetch() {
  $CURL "https://registry.npmjs.org/@opentui/core/-/core-${VERSION}.tgz" -o core.tgz
  tar -zxf core.tgz
  rm core.tgz
  mv package "${PKG_DIR}"

  $CURL "https://codeload.github.com/anomalyco/opentui/tar.gz/refs/tags/v${VERSION}" \
    -o "${SRC}.tar.gz"
  tar -zxf "${SRC}.tar.gz"
  rm "${SRC}.tar.gz"
}

# ============================== build ==============================

do_build() {
  cd "${ROOT}/${SRC}"
  patch -p1 < "${PORT_DIR}/patchs/0002-openharmony-core-src.patch"
  patch -p1 < "${PORT_DIR}/patchs/0003-ohos-weak-pthread-tryjoin.patch"
  # toybox patch 对错 header 静默 no-op，打完必须 grep marker
  grep -q '"#opentui/parser-worker"' packages/core/scripts/build.ts
  grep -q 'core-openharmony-arm64' packages/core/src/platform/runtime-assets.bun.ts
  grep -q 'core-openharmony-arm64' packages/core/src/platform/runtime-assets.node.ts
  grep -q 'linkage = .weak' packages/native/src/clipboard/host.zig

  bun install --ignore-scripts
  cd packages/core
  bun scripts/build.ts --lib

  # 拼接：JS 全量取重建产物，其余（d.ts/assets/LICENSE/README）留官方
  cd "${ROOT}"
  rm -f "${PKG_DIR}"/*.js "${PKG_DIR}"/*.js.map
  rm -f "${PKG_DIR}/lib/tree-sitter/update-assets.js" \
        "${PKG_DIR}/lib/tree-sitter/update-assets.js.map"
  for f in "${DIST}"/*.js "${DIST}"/*.js.map; do
    cp "$f" "${PKG_DIR}/"
  done
  cp "${DIST}/lib/tree-sitter/update-assets.js"     "${PKG_DIR}/lib/tree-sitter/"
  cp "${DIST}/lib/tree-sitter/update-assets.js.map" "${PKG_DIR}/lib/tree-sitter/"
}

# ============================== package ==============================

do_package() {
  cd "${ROOT}/${PKG_DIR}"
  patch -p1 < "${PORT_DIR}/patchs/0001-update-package-json.patch"
  cd "${ROOT}"
  # 父包不携带 native，槽位包负责
  if find "${PKG_DIR}" -name '*.so' | grep -q .; then
    echo "parent package must not ship native libraries" >&2
    exit 1
  fi
}

# ============================== test ==============================

do_test() {
  # --- 包静态断言 ---
  cd "${ROOT}/${PKG_DIR}"
  NAME=$(node -e "console.log(require('./package.json').name)")
  [ "$NAME" = "@ohos-npm-ports/opentui-core" ]
  grep -q '"#opentui/parser-worker": "./parser.worker.js"' package.json

  for f in ./*.js ./lib/tree-sitter/*.js; do
    node --check "$f"
  done

  # 上游平台包保持上游 base 版本；槽位 alias 钉到本仓发布的槽位版本
  SLOT_VERSION="$SLOT_VERSION" node -e '
    const pkg = require("./package.json");
    const base = pkg.version.replace(/-.*$/, "");
    const opt = pkg.optionalDependencies ?? {};
    const slotAlias = `npm:@ohos-npm-ports/opentui-core-openharmony-arm64@${process.env.SLOT_VERSION}`;
    if (opt["@opentui/core-openharmony-arm64"] !== slotAlias) {
      console.error(`slot alias mismatch: ${opt["@opentui/core-openharmony-arm64"]}`);
      process.exit(1);
    }
    for (const [name, range] of Object.entries(opt)) {
      if (name === "@opentui/core-openharmony-arm64") continue;
      if (range !== base) { console.error(`${name} = ${range}, expected ${base}`); process.exit(1); }
    }
  '

  # 标记断言针对 chunk 集合整体（bun splitting 会产出不含标记的共享块）
  for marker in 'openharmony: "libopentui.so"' '"@opentui/core-openharmony-arm64"'; do
    grep -qF "$marker" chunk-bun-*.js
    grep -qF "$marker" chunk-node-*.js
  done
  grep -qF '#opentui/parser-worker' chunk-bun-*.js
  grep -qF 'openharmony: "libopentui.so"' node-assets.js

  # npm alias override 会令裸名 @opentui/core 自引用无法解析
  if grep -rnE '(from|import\(|require\()"@opentui/core["/]' --include='*.js' .; then
    echo "Bare @opentui/core self-import found (breaks npm alias override resolution)" >&2
    exit 1
  fi

  # --- e2e 冒烟脚手架：临时槽位（真实 native、与槽位 port 同源；构建期产物不签名） ---
  cd "${ROOT}/${SRC}/packages/native"
  sh scripts/prepare-zig-deps.sh
  "${ROOT}/zig-aarch64-linux-${ZIG_VERSION}/zig" build -Dlibrary-target=aarch64-linux-musl -Doptimize=ReleaseFast
  [ -f "${ROOT}/${NATIVE_LIB}" ] || { echo "no libopentui.so under lib/aarch64-linux-musl" >&2; exit 1; }
  readelf -h "${ROOT}/${NATIVE_LIB}" | grep -q 'AArch64'
  readelf --dyn-syms "${ROOT}/${NATIVE_LIB}" | grep 'pthread_tryjoin_np' | grep -q ' WEAK '
  python3 -c "import ctypes; ctypes.CDLL('${ROOT}/${NATIVE_LIB}'); print('dlopen OK')"

  SLOT="${ROOT}/smoke-slot"
  mkdir -p "$SLOT"
  cd "$SLOT"
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
  "name": "@ohos-npm-ports/opentui-core-openharmony-arm64",
  "version": "${SLOT_VERSION}",
  "description": "Prebuilt openharmony-arm64 binaries for @opentui/core",
  "type": "module",
  "main": "index.js",
  "module": "index.js",
  "types": "index.d.ts",
  "license": "MIT",
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
  cp wuffs/LICENSE   "$SLOT/LICENSE-WUFFS"
  cp stb/LICENSE     "$SLOT/LICENSE-STB"
  cp libwebp/COPYING "$SLOT/LICENSE-LIBWEBP"
  cp libwebp/PATENTS "$SLOT/PATENTS-LIBWEBP"
  cp libwebp/AUTHORS "$SLOT/AUTHORS-LIBWEBP"
  cp lcms2/LICENSE   "$SLOT/LICENSE-LCMS2"
  cp "${ROOT}/${SRC}/packages/core/THIRD_PARTY_LICENSES/GHOSTTY" "$SLOT/LICENSE-GHOSTTY"

  # --- e2e：bun 渲染 + compile 独立二进制（native 经消费方 bundler 内嵌）+ node import ---
  APP="${ROOT}/smoke-app"
  mkdir -p "${APP}/node_modules/@ohos-npm-ports" "${APP}/node_modules/@opentui"
  cd "$APP"
  printf '{"name":"smoke","version":"1.0.0"}\n' > package.json
  bun add web-tree-sitter@0.25.10
  cp -r "${ROOT}/${PKG_DIR}" node_modules/@ohos-npm-ports/opentui-core
  cp -r "$SLOT" node_modules/@opentui/core-openharmony-arm64

  cat > app.mjs <<'EOF'
import { createTestRenderer } from "@ohos-npm-ports/opentui-core/testing"
import { BoxRenderable } from "@ohos-npm-ports/opentui-core"

const setup = await createTestRenderer({ width: 30, height: 10 })
const box = new BoxRenderable(setup.renderer, { width: 10, height: 3, border: true, title: "ohos" })
setup.renderer.root.add(box)
await setup.renderOnce()
const frame = setup.captureCharFrame()
if (!frame.includes("ohos")) throw new Error("frame missing box title")
console.log("SMOKE-OK bun-render")
await setup.renderer.destroy()
EOF
  bun app.mjs

  bun build --compile app.mjs --outfile smoke-bin
  mkdir isolated
  cp smoke-bin isolated/
  cd isolated
  ./smoke-bin

  cd "$APP"
  node -e 'import("@ohos-npm-ports/opentui-core").then(() => console.log("SMOKE-OK node-import"))'
}

# ============================== 执行（deps → fetch → build → package → test） ==============================

do_deps
do_fetch
do_build
do_package
do_test

echo "OK: @ohos-npm-ports/opentui-core ${VERSION}-2 rebuilt from source (slot: openharmony-arm64 ${SLOT_VERSION})"
