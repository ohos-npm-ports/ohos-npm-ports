#!/bin/sh
set -e

# ============================================================
# ohos-npm-ports: @ohos-npm-ports/yuku-parser 0.9.3-1
#
# 构建方式：
#   1. 下载官方 yuku-parser@0.9.3 tarball 与 yuku monorepo v0.9.3，
#      钉住 npm tarball 的 sha256
#   2. 打 patch 改写 manifest（name/version/repository/files），grep marker
#   3. 用 zig 把 monorepo 里的 napi-zig binding 交叉编译到
#      aarch64-linux-musl（与 OHOS 同 libc 族）
#   4. 零依赖重打包：上游全部内容进发布目录，签名后的 binding 嵌进
#      @yuku-parser/binding-openharmony-arm64/
#   5. 用真实 loader 冒烟（容器 node 的 process.platform 就是 openharmony）
#
# binding.js 按 process.platform/process.arch 拼后缀，包内路径即 openharmony
# 分支的第一个候选。
#
# 发布目录名由 publish.sh 约定为 <pkg>-<version>，必须留在 port 目录根下，
# 所以中间件放 STAGE，成品由 do_package 落到 OUT，do_test 不删 OUT。
# ============================================================

PKG_NAME="yuku-parser"
PKG_VERSION="0.9.3"
PORTS_VERSION="0.9.3-1"
SLOT="@yuku-parser/binding-openharmony-arm64"
ZIG_VERSION="0.16.0"
ZIG_SHA256="ea4b09bfb22ec6f6c6ceac57ab63efb6b46e17ab08d21f69f3a48b38e1534f17"
WORK_DIR="$(pwd)"
STAGE="${WORK_DIR}/build"
OUT="${WORK_DIR}/${PKG_NAME}-${PKG_VERSION}"

CURL="curl -fsSL --retry 8 --retry-all-errors --connect-timeout 30 --speed-limit 10240 --speed-time 30"

# ===== fetch =====
do_fetch() {
    echo "=== fetch: 官方 ${PKG_NAME}@${PKG_VERSION} + yuku monorepo + zig ==="
    rm -rf "${STAGE}"
    mkdir -p "${STAGE}"
    cd "${STAGE}"

    $CURL "https://registry.npmjs.org/${PKG_NAME}/-/${PKG_NAME}-${PKG_VERSION}.tgz" -o src.tgz
    echo "20ace3104335d69cf18f6a029bedb811c54aa60fd6e4237b437d46d45cb70666  src.tgz" | sha256sum -c -
    tar -zxf src.tgz
    rm src.tgz
    mv package src

    $CURL "https://github.com/yuku-toolchain/yuku/archive/refs/tags/v${PKG_VERSION}.tar.gz" -o yuku.tgz
    tar -zxf yuku.tgz
    rm yuku.tgz
    mv "yuku-${PKG_VERSION}" yuku

    $CURL "https://ziglang.org/download/${ZIG_VERSION}/zig-aarch64-linux-${ZIG_VERSION}.tar.xz" -o zig.tar.xz
    echo "${ZIG_SHA256}  zig.tar.xz" | sha256sum -c -
    tar -xJf zig.tar.xz
    rm zig.tar.xz
}

# ===== build =====
do_build() {
    echo "=== build: 打 patch + grep marker + 交叉编译 napi-zig binding ==="
    cd "${STAGE}/src"

    # do_test 拿它断言 patch 只改了 package.json
    find . -type f -exec sha256sum {} + | sed 's|\./||' | sort > "${WORK_DIR}/before.sha256"

    patch -p1 < "${WORK_DIR}/patchs/0001-update-package-json.patch"
    # patch 对零上下文 hunk 的越界行号会静默套用到文件末尾（exit 0）
    grep -q "\"name\": \"@ohos-npm-ports/${PKG_NAME}\"" package.json
    grep -q "\"version\": \"${PORTS_VERSION}\"" package.json
    grep -q "\"${SLOT}\"" package.json

    cd "${STAGE}/yuku"
    "${STAGE}/zig-aarch64-linux-${ZIG_VERSION}/zig" build \
        -Dtarget=aarch64-linux-musl -Doptimize=ReleaseFast
    test -f "zig-out/lib/${PKG_NAME}.node"
    cp "zig-out/lib/${PKG_NAME}.node" "${STAGE}/${PKG_NAME}.node"
}

# ===== package =====
do_package() {
    echo "=== package: 组装发布目录 + 嵌入签名 binding + manifest 断言 ==="
    rm -rf "${OUT}"
    cp -a "${STAGE}/src" "${OUT}"

    mkdir -p "${OUT}/${SLOT}"
    binary-sign-tool sign -selfSign 1 \
        -inFile "${STAGE}/${PKG_NAME}.node" \
        -outFile "${OUT}/${SLOT}/${PKG_NAME}.node"

    cd "${OUT}"
    node -e '
      const p = require("./package.json");
      if (p.name !== "@ohos-npm-ports/yuku-parser") { console.error("bad name: " + p.name); process.exit(1); }
      if (p.version !== "0.9.3-1") { console.error("bad version: " + p.version); process.exit(1); }
      console.log("OK: manifest");
    '
}

# ===== test =====
do_test() {
    echo "=== test: 哈希不变量 + ELF + 签名 + 真实 loader 冒烟 ==="
    cd "${OUT}"

    # 剔除 patch 允许改写的 package.json 与组装新增的 binding，其余须逐字节一致
    find . -type f -exec sha256sum {} + | sed 's|\./||' | sort > "${WORK_DIR}/after.sha256"
    grep -v '  package\.json$' "${WORK_DIR}/before.sha256" > "${WORK_DIR}/before.filtered"
    grep -v -e '  package\.json$' -e "  ${SLOT}/${PKG_NAME}\.node$" \
        "${WORK_DIR}/after.sha256" > "${WORK_DIR}/after.filtered"
    diff "${WORK_DIR}/before.filtered" "${WORK_DIR}/after.filtered"

    readelf -h "${SLOT}/${PKG_NAME}.node" | grep -q 'AArch64'
    readelf -S "${SLOT}/${PKG_NAME}.node" | grep -q '\.codesign'
    test ! -x "${SLOT}/${PKG_NAME}.node"

    # 容器 node 报 openharmony，这次 load 走的是真实解析路径
    node -e "const b = require('./binding.js'); console.log('loader smoke:', typeof b)"

    cd "${WORK_DIR}"
    rm -rf "${STAGE}"
    rm -f "${WORK_DIR}"/before.sha256 "${WORK_DIR}"/after.sha256 \
          "${WORK_DIR}"/before.filtered "${WORK_DIR}/after.filtered"
    test -d "${OUT}"
}

do_fetch
do_build
do_package
do_test

echo "OK: @ohos-npm-ports/${PKG_NAME} ${PORTS_VERSION} built and smoke-tested"
