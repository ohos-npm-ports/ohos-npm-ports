#!/bin/sh
set -e

# tsgo（@typescript/native-preview）：Go 写的 TypeScript 原生编译器。
# 官方 npm 包重打包（纯 wrapper：bin/tsgo → getExePath → 平台二进制）+ 用同一个
# 上游 commit 的源码原生静态编译，二进制装进平台槽位包
# @ohos-npm-ports/typescript-native-preview-openharmony-arm64
# （lib/tsgo + lib/*.d.ts，os/cpu 限定，preferUnplugged）；
# loader 在 openharmony 下解析槽位包，其余平台仍走上游的平台槽位包
# （0002 只改了 openharmony 分支的包名，不动上游解析）。

VERSION=7.0.0-dev.20260707.2
PORTS_VERSION="${VERSION}-1"
PKG=typescript-native-preview
SLOT_NAME="typescript-native-preview-openharmony-arm64"
SLOT_PKG_NAME="@ohos-npm-ports/${SLOT_NAME}"
TGZ_SHA256=50cd22d1de46ec5f39ab27edf10d1b4ab35937eb1a6edcb171370f361b572289
TSGO_COMMIT=9977d6d38fcc78de8ae71770f3aa08256e6cc861
ROOT="$(pwd)"

CURL="curl -fsSL --retry 8 --retry-all-errors --connect-timeout 30 --speed-limit 10240 --speed-time 30"

B="${ROOT}/build"
PKG_DIR="${B}/${PKG}-${VERSION}"
SLOT_DIR="${B}/${SLOT_NAME}"
SRC_DIR="${B}/typescript-go"

# ============================== deps ==============================
do_deps() {
  brew install -y go git
  # harmonybrew 的 go 把工作目录 baked 成设备专属路径，容器里会 "creating work dir" 失败。
  # go 认的是 GOTMPDIR（不是 TMPDIR），缓存同理一律重定向到 ${B}。
  export GOTMPDIR="${B}/.gotmpdir"
  export GOCACHE="${B}/.gocache"
  export GOMODCACHE="${B}/.gomodcache"
  mkdir -p "${GOTMPDIR}" "${GOCACHE}" "${GOMODCACHE}"
}

# ============================== fetch ==============================
do_fetch() {
  rm -rf "${PKG_DIR}" "${SLOT_DIR}" "${SRC_DIR}"
  mkdir -p "${B}" "${SLOT_DIR}/lib"

  $CURL "https://registry.npmjs.org/@typescript/native-preview/-/native-preview-${VERSION}.tgz" \
    -o "${B}/native-preview.tgz"
  echo "${TGZ_SHA256}  ${B}/native-preview.tgz" | sha256sum -c -
  tar -zxf "${B}/native-preview.tgz" -C "${B}"
  rm "${B}/native-preview.tgz"
  mv "${B}/package" "${PKG_DIR}"

  # 编译器源码：commit 由上游 npm 包 package.json 的 gitHead 钉死，保证与
  # 包内 JS 包装层（dist/ 等）出自同一棵树。
  git init -q "${SRC_DIR}"
  git -C "${SRC_DIR}" remote add origin https://github.com/microsoft/typescript-go.git
  git -C "${SRC_DIR}" fetch --depth 1 origin "${TSGO_COMMIT}"
  git -C "${SRC_DIR}" checkout -q FETCH_HEAD
}

# ============================== build ==============================
do_build() {
  cd "${SRC_DIR}"
  patch -p1 < "${ROOT}/patchs/0003-skip-fanotify-on-hongmeng.patch"
  grep -q "hongMengKernel" "${SRC_DIR}/internal/fswatch/fanotify_linux.go"

  # noembed 模式下 lib.d.ts 需与二进制同目录
  go build -ldflags="-s -w" -trimpath -tags=noembed -o "${SLOT_DIR}/lib/tsgo" ./cmd/tsgo
  cp "${SRC_DIR}/internal/bundled/libs/"*.d.ts "${SLOT_DIR}/lib/"

  cd "${PKG_DIR}"
  patch -p1 < "${ROOT}/patchs/0001-update-package-json.patch"
  grep -q '"name": "@ohos-npm-ports/typescript-native-preview"' package.json
  patch -p1 < "${ROOT}/patchs/0002-add-openharmony-support.patch"
  grep -qF "${SLOT_PKG_NAME}" lib/getExePath.js
}

# ============================== package ==============================
do_package() {
  # 槽位包：二进制 + noembed 声明文件 + 法务文件
  cp "${PKG_DIR}/LICENSE" "${PKG_DIR}/NOTICE.txt" "${SLOT_DIR}/"
  chmod +x "${SLOT_DIR}/lib/tsgo"
  # 发布物签名（内容完整性层）：OHOS host 上的 go 链接器已嵌入 .codesign；
  # 万一缺签，用官方工具补（CI 镜像里恒有该工具）。
  if ! readelf -S "${SLOT_DIR}/lib/tsgo" | grep -q '\.codesign'; then
    binary-sign-tool sign -selfSign 1 -inFile "${SLOT_DIR}/lib/tsgo" -outFile "${SLOT_DIR}/lib/tsgo.signed"
    chmod +x "${SLOT_DIR}/lib/tsgo.signed"
    mv "${SLOT_DIR}/lib/tsgo.signed" "${SLOT_DIR}/lib/tsgo"
  fi

  cat > "${SLOT_DIR}/package.json" <<EOF
{
  "name": "${SLOT_PKG_NAME}",
  "version": "${PORTS_VERSION}",
  "description": "OpenHarmony arm64 native tsgo binary for @ohos-npm-ports/typescript-native-preview",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/ohos-npm-ports/ohos-npm-ports.git",
    "directory": "ports/typescript-native-preview/${VERSION}"
  },
  "license": "Apache-2.0",
  "preferUnplugged": true,
  "os": ["openharmony"],
  "cpu": ["arm64"],
  "files": ["lib", "LICENSE", "NOTICE.txt"],
  "publishConfig": { "access": "public" }
}
EOF
}

# ============================== test ==============================
do_test() {
  cd "${PKG_DIR}"

  node -e "
const p = require('./package.json');
if (p.name !== '@ohos-npm-ports/typescript-native-preview') throw new Error('name: ' + p.name);
if (p.version !== '${PORTS_VERSION}') throw new Error('version: ' + p.version);
const d = Object.keys(p.optionalDependencies || {});
if (d.length !== 8) throw new Error('optionalDependencies: ' + d.join(','));
if (!d.includes('@typescript/native-preview-linux-arm64')) throw new Error('missing linux-arm64 slot');
if (!d.includes('@ohos-npm-ports/typescript-native-preview-openharmony-arm64')) throw new Error('missing openharmony slot');
"
  node --check lib/getExePath.js
  node --check lib/tsgo.js
  node --check bin/tsgo

  # 槽位包二进制：架构 / 签名 / 静态（无 INTERP）
  readelf -h "${SLOT_DIR}/lib/tsgo" | grep -q 'AArch64'
  readelf -S "${SLOT_DIR}/lib/tsgo" | grep -q '\.codesign'
  readelf -l "${SLOT_DIR}/lib/tsgo" | grep -q INTERP && { echo "ERROR: tsgo is not static" >&2; exit 1; } || true

  # e2e：槽位包二进制真跑一次 typecheck
  SMOKE="$(mktemp -d)"
  cd "${SMOKE}"
  printf '{"compilerOptions":{"strict":true}}' > tsconfig.json
  printf 'const n: number = "x";\n' > bad.ts
  "${SLOT_DIR}/lib/tsgo" --version
  "${SLOT_DIR}/lib/tsgo" --noEmit -p tsconfig.json > out.txt 2>&1 || true
  grep -q 'error TS2322' out.txt || { cat out.txt >&2; exit 1; }
  cd "${PKG_DIR}"
  rm -rf "${SMOKE}"
}

do_deps
do_fetch
do_build
do_package
do_test

echo "OK: ${SLOT_PKG_NAME} + @ohos-npm-ports/${PKG} ${PORTS_VERSION} (tsgo ${VERSION}, openharmony-arm64, signed, typecheck smoke passed)"
