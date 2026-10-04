#!/bin/sh
set -e

# ============================================================
# ohos-npm-ports: @ohos-npm-ports/bun 1.4.2-1
#
# 构建方式（对应 Harmonybrew 官方 core 的 Formula/b/bun.rb）：
#   1. 拉取 bun-v1.4.2 源码，核对 commit；拉取固定 commit 的官方 core，
#      取其中的 OHOS 补丁集与 formula 内的 DATA 补丁
#   2. 应用补丁，改 -march 与 ICU 链接参数，浅克隆 WebKit 并应用 suspend-resume
#   3. 用 Harmonybrew 官方 core 的 bun 引导，bun run build:release:local --abi=ohos
#   4. 槽位包 @ohos-npm-ports/oven-bun-openharmony-arm64 携带二进制（strip + 签名）
#   5. 主包 = 上游 bun npm 包装重打包：改名 + install.js 增加 openharmony 条目
# ============================================================

PKG_NAME="bun"
PKG_VERSION="1.4.2"
PORTS_VERSION="1.4.2-1"
SLOT_NAME="oven-bun-openharmony-arm64"
WORK_DIR="$(pwd)"
BUILD_DIR="${WORK_DIR}/build"

BUN_REPO="https://github.com/oven-sh/bun.git"
BUN_TAG="bun-v${PKG_VERSION}"
BUN_REVISION="744846f844374847c902b5e7fd59b4342a51ef99"

CORE_REPO="https://atomgit.com/Harmonybrew/homebrew-core.git"
CORE_REVISION="da37a24394edf633687353ed6cbb870be5c232fa"

NPM_URL="https://registry.npmjs.org/bun/-/bun-${PKG_VERSION}.tgz"
NPM_SHA256="f3eb7abed7854e99affc6f4a8d1ddff865baeaa5d33f70fc358b1e9aff4f0dff"

CURL="curl -fsSL --retry 8 --retry-all-errors --connect-timeout 30"

# 失败重试的浅克隆：$1=目的目录，其余参数原样交给 git clone
git_clone_retry() {
    dest="$1"
    shift
    n=0
    until git clone -q --depth 1 "$@" "${dest}"; do
        n=$((n + 1))
        test "$n" -lt 5
        rm -rf "${dest}"
        sleep 10
    done
}

# 失败重试的 git：浅取指定 commit
git_fetch_commit() {
    # $1=目录 $2=仓库 $3=commit
    rm -rf "$1"
    mkdir -p "$1"
    git -C "$1" init -q
    git -C "$1" remote add origin "$2"
    n=0
    until git -C "$1" fetch -q --depth 1 origin "$3"; do
        n=$((n + 1))
        test "$n" -lt 5
        sleep 10
    done
    git -C "$1" checkout -q FETCH_HEAD
    test "$(git -C "$1" rev-parse HEAD)" = "$3"
}

do_deps() {
    echo "=== deps: toolchain ==="
    mkdir -p /data/storage/el2/base/cache /data/storage/el2/base/file
    # llvm@21 与镜像预装的 ohos-sdk 都提供 clang，brew 拒绝同时 link
    brew unlink ohos-sdk
    # 不装 gcc：它与镜像里 devel-base 带来的 llvm-gcc-compat 互斥；bun 用官方 core 的当引导
    brew install -y llvm@21 lld@21 ohos-selfsign cmake ninja gperf icu4c@78 ruby bun
    llvm_prefix="$(brew --prefix llvm@21)"
    lld_prefix="$(brew --prefix lld@21)"
    export PATH="${llvm_prefix}/bin:${lld_prefix}/bin:${PATH}"
    # WebKit 的 preprocess.pl 在没设 CC 时只找 /usr/bin/clang、/usr/bin/gcc，镜像里都没有
    export CC="${llvm_prefix}/bin/clang"
    export CXX="${llvm_prefix}/bin/clang++"
    clang --version | head -1
    ld.lld --version | head -1
    # 装漏了或没 link 的在这里直接报出来
    for tool in cmake ninja gperf selfsign llvm-strip bun ruby perl python3 patch git npm node readelf nproc; do
        command -v "${tool}" >/dev/null || {
            echo "missing build tool: ${tool}"
            exit 1
        }
    done
    # bun 把 ICU 静态链接进去，缺静态库要到链接阶段才会暴露
    icu_prefix="$(brew --prefix icu4c@78)"
    for lib in libicui18n.a libicuuc.a libicudata.a; do
        test -f "${icu_prefix}/lib/${lib}" || {
            echo "missing ${icu_prefix}/lib/${lib}"
            exit 1
        }
    done
    # 这里没有 Homebrew superenv，ICU 的头文件和库目录要自己给编译器和链接器
    export CPATH="${icu_prefix}/include${CPATH:+:${CPATH}}"
    export LIBRARY_PATH="${icu_prefix}/lib${LIBRARY_PATH:+:${LIBRARY_PATH}}"
    # 镜像里 rustup 默认走阿里云镜像站，那里没有 bun 钉死的历史 nightly
    export RUSTUP_DIST_SERVER="https://static.rust-lang.org"
}

do_fetch() {
    echo "=== fetch: sources ==="
    rm -rf "${BUILD_DIR}"
    mkdir -p "${BUILD_DIR}"

    # bun 源码：构建要 git 检出，用 commit 固定来源
    git_clone_retry "${BUILD_DIR}/bun-src" --branch "${BUN_TAG}" "${BUN_REPO}"
    test "$(git -C "${BUILD_DIR}/bun-src" rev-parse HEAD)" = "${BUN_REVISION}"

    # 官方 core 固定 commit：补丁集与 formula
    git_fetch_commit "${BUILD_DIR}/core" "${CORE_REPO}" "${CORE_REVISION}"
    test "$(ls "${BUILD_DIR}/core/Patches/bun" | wc -l)" -gt 0
    grep -qF "bun-v${PKG_VERSION}" "${BUILD_DIR}/core/Formula/b/bun.rb"
    grep -qF "${BUN_REVISION}" "${BUILD_DIR}/core/Formula/b/bun.rb"

    # 上游 npm 包装：主包的重打包基线
    $CURL "${NPM_URL}" -o "${BUILD_DIR}/bun-npm.tgz"
    echo "${NPM_SHA256}  ${BUILD_DIR}/bun-npm.tgz" | sha256sum -c -
    mkdir -p "${BUILD_DIR}/wrapper"
    tar -zxf "${BUILD_DIR}/bun-npm.tgz" -C "${BUILD_DIR}/wrapper"
    # pristine-diff 基线：补丁只允许碰 package.json 和 install.js
    node -e '
        const fs = require("fs"), crypto = require("crypto"), path = require("path");
        const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
            e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
        const hashes = {};
        for (const f of walk(process.argv[1]).sort()) {
            hashes[path.relative(process.argv[1], f)] =
                crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
        }
        fs.writeFileSync(process.argv[2], JSON.stringify(hashes, null, 1));
    ' "${BUILD_DIR}/wrapper/package" "${BUILD_DIR}/wrapper-pristine.json"
}

# 对 SRC 下的文件做字面量替换；锚点不存在或不唯一就失败，不静默跳过
replace_once() {
    # $1=文件 $2=旧 $3=新
    node -e '
        const fs = require("fs");
        const [file, from, to] = process.argv.slice(1);
        const s = fs.readFileSync(file, "utf8");
        const n = s.split(from).length - 1;
        if (n !== 1) throw new Error("anchor must match once, got " + n + ": " + from);
        fs.writeFileSync(file, s.replace(from, () => to));
    ' "$1" "$2" "$3"
}

# 同 Homebrew 的 inreplace：替换所有出现处；一处都没有就失败
replace_all() {
    # $1=文件 $2=旧 $3=新
    node -e '
        const fs = require("fs");
        const [file, from, to] = process.argv.slice(1);
        const s = fs.readFileSync(file, "utf8");
        if (!s.includes(from)) throw new Error("anchor missing: " + from);
        fs.writeFileSync(file, s.split(from).join(to));
    ' "$1" "$2" "$3"
}

do_build() {
    echo "=== build: patch + bun build ==="
    SRC="${BUILD_DIR}/bun-src"
    CORE="${BUILD_DIR}/core"

    # 官方 core 的补丁集：formula 用 Dir[...] 的排序顺序逐个应用
    # 其中 patches_*.patch.patch 是针对 bun 自带 patches/ 目录内文件的补丁
    n=0
    for p in $(ls "${CORE}"/Patches/bun/*.patch | LC_ALL=C sort); do
        (cd "${SRC}" && git apply "$p")
        n=$((n + 1))
    done
    echo "applied ${n} patches"
    test "${n}" -ge 70
    # 标记：OHOS 相关补丁确实生效
    grep -qF '"ohos"' "${SRC}/scripts/build/config.ts"
    test -f "${SRC}/src/ohos_sign/src/lib.rs"

    # formula 末尾 __END__ 之后的 DATA 补丁（clang 23 适配）
    line="$(grep -n '^__END__' "${CORE}/Formula/b/bun.rb" | cut -d: -f1)"
    test -n "${line}"
    tail -n +"$((line + 1))" "${CORE}/Formula/b/bun.rb" > "${BUILD_DIR}/formula-data.patch"
    (cd "${SRC}" && git apply "${BUILD_DIR}/formula-data.patch")
    grep -qF 'RETURN_IF_EXCEPTION(scope, void());' "${SRC}/src/jsc/bindings/JSMockFunction.cpp"

    # 官方 core 用 musl 版 bun（报告 linux）做引导，所以没碰到：这里用 OHOS 版 bun 引导，
    # 它报告 openharmony，scripts/utils.mjs 的 parseOs 不认
    (cd "${SRC}" && git apply "${WORK_DIR}/patchs/0003-openharmony-host-os.patch")
    grep -qF 'linux|android|openharmony' "${SRC}/scripts/utils.mjs"

    # 上游只放行它支持的微架构，OHOS 上换成 brew superenv 在 arm64 上用的值；
    # ICU 改静态链接，运行时不依赖 libicu*
    replace_all "${SRC}/scripts/build/flags.ts" '-march=armv8-a+crc' '-march=armv8-a'
    replace_once "${SRC}/scripts/build/bun.ts" \
        '"-licudata", "-licui18n", "-licuuc"' \
        '"-l:libicui18n.a", "-l:libicuuc.a", "-l:libicudata.a"'
    if grep -qF -- '-march=armv8-a+crc' "${SRC}/scripts/build/flags.ts"; then
        echo "flags.ts still carries -march=armv8-a+crc"
        exit 1
    fi
    grep -qF -- '-l:libicui18n.a' "${SRC}/scripts/build/bun.ts"

    # WebKit：整库约 18GB，改浅克隆；版本取自 bun 的构建脚本
    webkit_version="$(sed -n 's/.*WEBKIT_VERSION = "\([0-9a-fA-F]*\)".*/\1/p' "${SRC}/scripts/build/deps/webkit.ts" | head -1)"
    test -n "${webkit_version}"
    git_clone_retry "${SRC}/vendor/WebKit" --branch "autobuild-${webkit_version}" \
        --config advice.detachedHead=false --config core.fsmonitor=false \
        https://github.com/oven-sh/WebKit.git
    # swiftc 的探测会让 WebKit 误判环境
    replace_once "${SRC}/vendor/WebKit/Source/cmake/WebKitFeatures.cmake" \
        'find_program(_WEBKIT_PROBE_SWIFTC NAMES swiftc)' ''
    # HongMeng 上线程暂停/恢复握手会卡在 sigsuspend，改成有界的 sigtimedwait 轮询
    (cd "${SRC}/vendor/WebKit" && git apply "${SRC}/patches/webkit/suspend-resume.patch")
    grep -qF 'sigtimedwait' "${SRC}/vendor/WebKit/Source/WTF/wtf/posix/ThreadingPOSIX.cpp"

    # 用 Harmonybrew 官方 core 已有的 bun 当引导：它本就是为 OHOS 构建、已签名的静态产物，
    # 不像上游的 musl 预编译包那样缺 libstdc++。构建脚本对引导 bun 没有版本要求
    bun_prefix="$(brew --prefix bun)"
    export PATH="${bun_prefix}/bin:${PATH}"
    # 嵌套的依赖构建不带 --parallel，用这个变量限制并发
    jobs="$(nproc)"
    export CMAKE_BUILD_PARALLEL_LEVEL="${jobs}"
    test "$(command -v bun)" = "${bun_prefix}/bin/bun"
    bun --version

    (cd "${SRC}" && bun run build:release:local --canary=off --abi=ohos)

    BIN="${SRC}/build/release-local/bun"
    test -f "${BIN}"
    "${BIN}" --version | grep -qF "${PKG_VERSION}"

    # strip 会一并去掉 lld 写入的旧签名，selfsign 才肯重新签
    cp "${BIN}" "${BUILD_DIR}/bun-bin"
    llvm-strip --strip-all "${BUILD_DIR}/bun-bin"
    selfsign "${BUILD_DIR}/bun-bin"
    chmod +x "${BUILD_DIR}/bun-bin"
}

do_package() {
    echo "=== package: slot + main ==="
    SLOT_DIR="${BUILD_DIR}/${SLOT_NAME}"
    rm -rf "${SLOT_DIR}"
    mkdir -p "${SLOT_DIR}/bin"
    cp "${BUILD_DIR}/bun-bin" "${SLOT_DIR}/bin/bun"
    chmod +x "${SLOT_DIR}/bin/bun"
    cat > "${SLOT_DIR}/package.json" <<EOF
{
  "name": "@ohos-npm-ports/${SLOT_NAME}",
  "version": "${PORTS_VERSION}",
  "description": "OpenHarmony arm64 binary for Bun, built from oven-sh/bun v${PKG_VERSION} with the Harmonybrew OHOS patches",
  "license": "MIT",
  "os": ["openharmony"],
  "cpu": ["arm64"],
  "repository": {
    "type": "git",
    "url": "https://github.com/ohos-npm-ports/ohos-npm-ports",
    "directory": "ports/bun/${PKG_VERSION}"
  },
  "publishConfig": {
    "executableFiles": ["./bin/bun"],
    "access": "public"
  }
}
EOF

    MAIN_DIR="${BUILD_DIR}/bun-wrapper-${PKG_VERSION}"
    mv "${BUILD_DIR}/wrapper/package" "${MAIN_DIR}"
    (cd "${MAIN_DIR}" && patch -p1 < "${WORK_DIR}/patchs/0001-update-package-json.patch")
    (cd "${MAIN_DIR}" && patch -p1 < "${WORK_DIR}/patchs/0002-install-openharmony.patch")
    grep -qF '"name": "@ohos-npm-ports/bun"' "${MAIN_DIR}/package.json"
    grep -qF 'scope: "@ohos-npm-ports"' "${MAIN_DIR}/install.js"

    # pristine-diff 不变量：组装产物与上游解包逐字节一致，
    # 唯一允许改写的文件是两个 patch 的载体
    node -e '
        const fs = require("fs"), crypto = require("crypto"), path = require("path");
        const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
            e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
        const current = {};
        for (const f of walk(process.argv[1]).sort()) {
            current[path.relative(process.argv[1], f)] =
                crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
        }
        const pristine = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
        const allowed = new Set(["package.json", "install.js"]);
        for (const k of new Set([...Object.keys(pristine), ...Object.keys(current)])) {
            if (pristine[k] !== current[k] && !allowed.has(k)) {
                throw new Error("wrapper drift beyond patched files: " + k);
            }
        }
    ' "${MAIN_DIR}" "${BUILD_DIR}/wrapper-pristine.json"
}

do_test() {
    echo "=== test: assertions ==="
    SLOT_DIR="${BUILD_DIR}/${SLOT_NAME}"
    MAIN_DIR="${BUILD_DIR}/bun-wrapper-${PKG_VERSION}"
    BUN="${SLOT_DIR}/bin/bun"

    # 包元数据：名字、版本、os/cpu，主包对槽位的引用
    node -e '
        const m = require(process.argv[1] + "/package.json");
        const s = require(process.argv[2] + "/package.json");
        const v = process.argv[3], slot = process.argv[4];
        if (m.name !== "@ohos-npm-ports/bun") throw new Error("main name: " + m.name);
        if (m.version !== v) throw new Error("main version: " + m.version);
        if (m.optionalDependencies["@ohos-npm-ports/" + slot] !== v) throw new Error("slot ref missing");
        if (!m.os.includes("openharmony")) throw new Error("main os lacks openharmony");
        if (s.name !== "@ohos-npm-ports/" + slot) throw new Error("slot name: " + s.name);
        if (s.version !== v) throw new Error("slot version: " + s.version);
        if (s.os[0] !== "openharmony" || s.cpu[0] !== "arm64") throw new Error("slot os/cpu");
    ' "${MAIN_DIR}" "${SLOT_DIR}" "${PORTS_VERSION}" "${SLOT_NAME}"

    # 二进制：带签名、静态链接（不依赖系统没有的 C++ 运行库）
    readelf -S "${BUN}" | grep -q '\.codesign'
    if readelf -d "${BUN}" | grep -E 'NEEDED' | grep -E 'libstdc\+\+|libgcc_s'; then
        echo "bun must not depend on libstdc++/libgcc_s"
        exit 1
    fi
    "${BUN}" --version | grep -qF "${PKG_VERSION}"
    if "${BUN}" --revision | grep -q canary; then
        echo "unexpected canary build"
        exit 1
    fi

    # 加载器：openharmony 命中槽位，其他平台仍走上游包
    # install.js 是会立刻执行安装的脚本，不能直接 require；
    # 把它的 platforms 表和 getSupportedPlatforms 原文截出来执行，测的就是产物自己的选择逻辑
    node -e '
        const src = require("fs").readFileSync(process.argv[1] + "/install.js", "utf8");
        const start = src.indexOf("platforms = [") + "platforms = ".length;
        let depth = 0, end = start;
        for (; end < src.length; end++) {
            if (src[end] === "[") depth++;
            if (src[end] === "]") { depth--; if (depth === 0) { end++; break; } }
        }
        const fnStart = src.indexOf("function getSupportedPlatforms(");
        const fnEnd = src.indexOf("__name(getSupportedPlatforms", fnStart);
        if (fnStart < 0 || fnEnd < 0) throw new Error("getSupportedPlatforms not found in install.js");
        const getSupportedPlatforms = new Function(
            "const platforms = " + src.slice(start, end) + ";\n" + src.slice(fnStart, fnEnd) +
            "\nreturn getSupportedPlatforms;",
        )();
        const names = (os, arch, abi) => getSupportedPlatforms(os, arch, abi)
            .map((p) => (p.scope || "@oven") + "/" + p.bin + "@" + (p.version || "1.4.2"));
        const eq = (got, want, what) => {
            if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(what + ": " + JSON.stringify(got));
        };
        eq(names("openharmony", "arm64", undefined), ["@ohos-npm-ports/oven-bun-openharmony-arm64@1.4.2-1"], "openharmony");
        eq(names("linux", "arm64", "musl"), ["@oven/bun-linux-aarch64-musl@1.4.2", "@oven/bun-linux-aarch64@1.4.2"], "linux musl");
        eq(names("linux", "arm64", undefined), ["@oven/bun-linux-aarch64@1.4.2"], "linux glibc");
        eq(names("darwin", "arm64", undefined), ["@oven/bun-darwin-aarch64@1.4.2"], "darwin");
        eq(names("win32", "x64", undefined), ["@oven/bun-windows-x64@1.4.2"], "win32");
    ' "${MAIN_DIR}"
    node --check "${MAIN_DIR}/install.js"

    # 功能自检（对应 formula 的 test do）
    T="${BUILD_DIR}/selftest"
    rm -rf "${T}"
    mkdir -p "${T}/home" "${T}/work"
    (
        cd "${T}/work"
        "${BUN}" init --yes >/dev/null
        test "$("${BUN}" run index.ts)" = "Hello via Bun!"
        "${BUN}" build --compile --outfile=hello index.ts >/dev/null
        test "$(./hello)" = "Hello via Bun!"
        cat > db.ts <<EOF
import { Database } from "bun:sqlite";
const db = new Database(":memory:");
db.run("create table s (name text, age integer)");
db.run("insert into s (name, age) values ('Bob', 14)");
db.run("insert into s (name, age) values ('Sue', 12)");
console.log(db.query("select name from s order by age asc").values().flat());
EOF
        test "$("${BUN}" run db.ts)" = '[ "Sue", "Bob" ]'
    )
    # 之前 @ohos-ports 的 beta 在这两处出错：清空环境下安装依赖、运行 bun x
    (
        cd "${T}/work"
        rm -rf node_modules bun.lock bun.lockb
        env -i HOME="${T}/home" TMPDIR="${TMPDIR:-/data/storage/el2/base/cache}" PATH=/usr/bin:/bin \
            "${BUN}" add is-number >/dev/null
        test -f node_modules/is-number/package.json
        env -i HOME="${T}/home" TMPDIR="${TMPDIR:-/data/storage/el2/base/cache}" PATH=/usr/bin:/bin \
            "${BUN}" x cowsay hello | grep -qF "< hello >"
    )

    # 消费冒烟：双包 npm pack 后干净工程安装，跑 install.js 把二进制放到 bin/bun.exe 并执行
    SMOKE="${BUILD_DIR}/smoke"
    rm -rf "${SMOKE}"
    mkdir -p "${SMOKE}/pkgs-slot" "${SMOKE}/pkgs-main" "${SMOKE}/proj"
    npm pack "${SLOT_DIR}" --pack-destination "${SMOKE}/pkgs-slot" >/dev/null
    npm pack "${MAIN_DIR}" --pack-destination "${SMOKE}/pkgs-main" >/dev/null
    SLOT_TGZ=$(ls "${SMOKE}/pkgs-slot/"*.tgz)
    MAIN_TGZ=$(ls "${SMOKE}/pkgs-main/"*.tgz)
    cd "${SMOKE}/proj"
    echo '{"name":"smoke"}' > package.json
    npm install --force --ignore-scripts "${SLOT_TGZ}" "${MAIN_TGZ}" >/dev/null
    cd node_modules/@ohos-npm-ports/bun
    node install.js
    test -x bin/bun.exe
    head -c 4 bin/bun.exe | od -An -tx1 | grep -q '7f 45 4c 46'
    ./bin/bun.exe --version | grep -qF "${PKG_VERSION}"

    # publish.sh 的 cd 目标即发布契约；PR 阶段 CI 跑不到 publish，这里降级成断言
    test -d "${WORK_DIR}/build/${SLOT_NAME}"
    test -d "${WORK_DIR}/build/bun-wrapper-${PKG_VERSION}"
}

do_deps
do_fetch
do_build
do_package
do_test

echo "=== done: ${BUILD_DIR}/bun-wrapper-${PKG_VERSION} + ${BUILD_DIR}/${SLOT_NAME} ==="
