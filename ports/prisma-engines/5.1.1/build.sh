#!/bin/sh
set -e

# ============================================================
# ohos-npm-ports: @ohos-npm-ports/prisma-engines 5.1.1-3
#
# 构建方式：
#   1. 官方 rust dist + prisma-engines 源码（prisma@5.1.1 pin 的 commit），
#      容器内 cargo 原生编译（query-engine N-API library + schema-engine CLI）
#   2. patch：workspace [patch.crates-io] 接线 + rustc 兼容修正 +
#      socket2/openssl-src 的 ohos target 修复（vendor 就地打）
#   3. llvm-strip + binary-sign-tool 双签名
#   4. 组装平台别名（debian-openssl 1.1.x/3.0.x 真拷贝）+ index.js 兼容面
#
# @prisma/get-platform never detects this platform, so consumers point
# PRISMA_QUERY_ENGINE_LIBRARY / PRISMA_SCHEMA_ENGINE_BINARY at these
# binaries directly (see index.js).
# ============================================================

PKG_NAME="prisma-engines"
PKG_VERSION="5.1.1"
PORTS_VERSION="5.1.1-3"
COMMIT="6a3747c37ff169c90047725a05a6ef02e32ac97e"
WORK_DIR="$(pwd)"
BUILD_DIR="${WORK_DIR}/build"

CURL="curl -fsSL --retry 8 --retry-all-errors --connect-timeout 30 --speed-limit 10240 --speed-time 30"

# ===== deps =====
do_deps() {
    echo "=== deps: brew 依赖（openssl@3/libxml2/zlib）==="
    brew install -y openssl@3 libxml2 zlib
}

# ===== fetch =====
do_fetch() {
    echo "=== fetch: 官方 rust dist（非 brew bottle）==="
    # the bottle's sysroot is newer than the CI container's libc, so its
    # products reference __fd_chk and fail to load there. LIBZ_SYS_STATIC:
    # nothing provides libz.so at runtime either.
    RUST_DIST="2026-08-20"
    RUST_VER="1.98.0"
    rm -rf "${BUILD_DIR}"
    mkdir -p "${BUILD_DIR}"
    cd "${BUILD_DIR}"
    $CURL "https://static.rust-lang.org/dist/${RUST_DIST}/rust-${RUST_VER}-aarch64-unknown-linux-ohos.tar.gz" -o rust-dist.tar.gz
    echo "db1b3c28a89a71594e9366b952ea5b34f7f9c66c853db7c3c637e59906cfcbc0  rust-dist.tar.gz" | sha256sum -c -
    mkdir -p rust-dist-extract
    tar -zxf rust-dist.tar.gz -C rust-dist-extract --strip-components=1
    rm rust-dist.tar.gz
    RUST_HOME="${BUILD_DIR}/rust-dist"
    sh rust-dist-extract/install.sh --prefix="${RUST_HOME}" --disable-ldconfig \
      --components=rustc,cargo,rust-std-aarch64-unknown-linux-ohos
    rm -rf rust-dist-extract

    echo "=== fetch: prisma-engines 源码（${COMMIT}）==="
    $CURL "https://github.com/prisma/${PKG_NAME}/archive/${COMMIT}.tar.gz" -o src.tar.gz
    tar -zxf src.tar.gz
    rm src.tar.gz
    mv "${PKG_NAME}-${COMMIT}" src
}

# ===== build =====
do_build() {
    echo "=== build: 应用补丁并断言 marker ==="
    cd "${BUILD_DIR}/src"
    patch -p1 < "${WORK_DIR}/patchs/0001-workspace-config-ohos.patch"
    patch -p1 < "${WORK_DIR}/patchs/0002-rustc-compat-fixes.patch"
    patch -p1 < "${WORK_DIR}/patchs/0005-build-rs-no-git-required.patch"
    # toybox patch can silently no-op on a malformed header; assert it landed.
    grep -q '\[patch.crates-io\]' Cargo.toml
    grep -q 'PanicHookInfo' libs/user-facing-errors/src/lib.rs
    grep -q 'GIT_HASH=6a3747c' query-engine/query-engine-node-api/build.rs
    grep -q 'GIT_HASH=6a3747c' schema-engine/cli/build.rs

    # socket2 and openssl-src lack an ohos arm in their cfg/target tables; the
    # vendored copies are fixed in place via [patch.crates-io] (0001).
    mkdir -p vendor
    $CURL "https://static.crates.io/crates/socket2/socket2-0.4.7.crate" -o socket2.crate
    mkdir -p vendor/socket2-0.4.7
    tar -zxf socket2.crate -C vendor/socket2-0.4.7 --strip-components=1
    rm socket2.crate
    (cd vendor/socket2-0.4.7 && patch -p1 < "${WORK_DIR}/patchs/0003-socket2-ohos-target.patch")
    grep -q 'target_env = "ohos"' vendor/socket2-0.4.7/src/sys/unix.rs

    $CURL "https://static.crates.io/crates/openssl-src/openssl-src-111.25.0+1.1.1t.crate" -o openssl-src.crate
    mkdir -p "vendor/openssl-src-111.25.0+1.1.1t"
    tar -zxf openssl-src.crate -C "vendor/openssl-src-111.25.0+1.1.1t" --strip-components=1
    rm openssl-src.crate
    (cd "vendor/openssl-src-111.25.0+1.1.1t" && patch -p1 < "${WORK_DIR}/patchs/0004-openssl-src-ohos-target.patch")
    grep -q 'aarch64-unknown-linux-ohos' 'vendor/openssl-src-111.25.0+1.1.1t/src/lib.rs'

    if ! curl -fsIL --max-time 8 -o /dev/null "https://index.crates.io/config.json" 2>/dev/null; then
      export CARGO_REGISTRIES_CRATES_IO_INDEX="sparse+https://rsproxy.cn/index/"
    fi

    echo "=== build: cargo 编译（vendored-openssl）==="
    export PATH="${BUILD_DIR}/rust-dist/bin:$PATH"
    # cargo verifies TLS against the system trust store, which is empty here.
    export LD_LIBRARY_PATH="$(brew --prefix openssl@3)/lib:$(brew --prefix libxml2)/lib:$(brew --prefix zlib)/lib"
    export CARGO_HTTP_CAINFO="$(brew --prefix)/etc/openssl@3/cert.pem"
    export LIBZ_SYS_STATIC=1
    cargo --version

    # No pkg-config/OPENSSL_DIR wiring for the ohos target: build OpenSSL from
    # source (first-class prisma-engines feature). The stub satisfies crt's
    # reference to the __fd_chk hardening hook, which older container libcs do
    # not export; on devices the real one is irrelevant either way.
    printf 'void __fd_chk(long fd) { (void)fd; }\n' > fdchk-stub.c
    cc -c fdchk-stub.c -o fdchk-stub.o
    export RUSTFLAGS="-C link-arg=$PWD/fdchk-stub.o"

    cargo build --release -p query-engine-node-api -p schema-engine-cli --features vendored-openssl

    QE_SRC="target/release/libquery_engine.so"
    SE_SRC="target/release/schema-engine"
    [ -f "$QE_SRC" ] || { echo "query engine .so missing" >&2; exit 1; }
    [ -f "$SE_SRC" ] || { echo "schema engine binary missing" >&2; exit 1; }
    readelf -h "$QE_SRC" | grep -q 'AArch64'
    readelf -h "$SE_SRC" | grep -q 'AArch64'
}

# ===== package =====
do_package() {
    echo "=== package: 组装发布目录 + 签名 + 别名 ==="
    rm -rf "${BUILD_DIR}/pkg"
    mkdir "${BUILD_DIR}/pkg"
    cp "${BUILD_DIR}/src/target/release/libquery_engine.so" "${BUILD_DIR}/pkg/libquery_engine.so"
    cp "${BUILD_DIR}/src/target/release/schema-engine" "${BUILD_DIR}/pkg/schema-engine"
    cp "${WORK_DIR}/package.json" "${BUILD_DIR}/pkg/package.json"
    cp "${WORK_DIR}/index.js" "${BUILD_DIR}/pkg/index.js"

    # The OHOS-patched LLD stamps a placeholder .codesign at link time which
    # binary-sign-tool refuses to overwrite -- strip first (ports/turbo does
    # the same).
    llvm-strip --strip-all "${BUILD_DIR}/pkg/libquery_engine.so"
    llvm-strip --strip-all "${BUILD_DIR}/pkg/schema-engine"
    binary-sign-tool sign -selfSign 1 -inFile "${BUILD_DIR}/pkg/libquery_engine.so" -outFile "${BUILD_DIR}/pkg/libquery_engine.so.signed"
    mv "${BUILD_DIR}/pkg/libquery_engine.so.signed" "${BUILD_DIR}/pkg/libquery_engine.so"
    binary-sign-tool sign -selfSign 1 -inFile "${BUILD_DIR}/pkg/schema-engine" -outFile "${BUILD_DIR}/pkg/schema-engine.signed"
    mv "${BUILD_DIR}/pkg/schema-engine.signed" "${BUILD_DIR}/pkg/schema-engine"
    chmod +x "${BUILD_DIR}/pkg/schema-engine"
    readelf -S "${BUILD_DIR}/pkg/libquery_engine.so" | grep -q '\.codesign'
    readelf -S "${BUILD_DIR}/pkg/schema-engine" | grep -q '\.codesign'

    # Alias names matching get-platform's binaryTarget fallback ("debian-openssl-
    # 1.1.x" on openharmony; the 3.0.x pair guards against libssl-probe drift).
    # prisma's engine lookup (resolveBinary / generate's copy) scans getEnginesPath
    # = the package root for exactly these names, so overrides of @prisma/engines
    # work without env vars. Real copies, not symlinks: npm pack silently drops
    # symlink entries, and node's require() resolves the symlink before picking
    # the loader, so a symlinked ".so.node" would be parsed as JS instead of
    # dlopened.
    cd "${BUILD_DIR}/pkg"
    cp libquery_engine.so libquery_engine-debian-openssl-1.1.x.so.node
    cp schema-engine schema-engine-debian-openssl-1.1.x
    cp libquery_engine.so libquery_engine-debian-openssl-3.0.x.so.node
    cp schema-engine schema-engine-debian-openssl-3.0.x
    for f in libquery_engine-debian-openssl-1.1.x.so.node schema-engine-debian-openssl-1.1.x libquery_engine-debian-openssl-3.0.x.so.node schema-engine-debian-openssl-3.0.x; do
      test -f "$f" && test ! -L "$f" || { echo "alias missing or not a regular file: $f" >&2; exit 1; }
    done
}

# ===== test =====
do_test() {
    # @prisma/engines compatibility surface (for the overrides route): the prisma
    # CLI accesses exactly these 4 symbols plus the default constant, and matches
    # the upstream values (@prisma/engines-version exports the bare commit;
    # DEFAULT_CLI_QUERY_ENGINE_BINARY_TYPE is "libquery-engine" in 5.x, anything
    # else makes the CLI's engineTypeToBinaryType throw).
    node -e '
      const e = require("'"${BUILD_DIR}"'/pkg/index.js");
      for (const k of ["getEnginesPath", "ensureBinariesExist", "getCliQueryEngineBinaryType", "enginesVersion", "DEFAULT_CLI_QUERY_ENGINE_BINARY_TYPE"]) {
        if (e[k] === undefined) { console.error("missing compat export: " + k); process.exit(1); }
      }
      if (e.DEFAULT_CLI_QUERY_ENGINE_BINARY_TYPE !== "libquery-engine") { console.error("wrong DEFAULT_CLI_QUERY_ENGINE_BINARY_TYPE: " + e.DEFAULT_CLI_QUERY_ENGINE_BINARY_TYPE); process.exit(1); }
      if (e.enginesVersion !== "6a3747c37ff169c90047725a05a6ef02e32ac97e") { console.error("wrong enginesVersion: " + e.enginesVersion); process.exit(1); }
      const p = e.getEnginesPath();
      for (const f of ["libquery_engine-debian-openssl-1.1.x.so.node", "schema-engine-debian-openssl-1.1.x"]) {
        require("fs").accessSync(require("path").join(p, f));
      }
      const lib = require(require("path").join(p, "libquery_engine-debian-openssl-1.1.x.so.node"));
      if (lib.version().commit !== "6a3747c37ff169c90047725a05a6ef02e32ac97e") { console.error("engine commit mismatch"); process.exit(1); }
      console.log("OK: @prisma/engines compatibility surface present at " + p);
    '
    # Real functional smoke: db push + generate + a PrismaClient round-trip.
    node -e '
      const path = require("path");
      const { execSync } = require("child_process");
      const fs = require("fs");
      const os = require("os");

      const pkg = require("'"${BUILD_DIR}"'/pkg/index.js");
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prisma-engines-smoke-"));
      process.chdir(dir);

      fs.writeFileSync("schema.prisma", `
generator client {
  provider = "prisma-client-js"
  output   = "client"
}
datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}
model Widget {
  id   Int    @id @default(autoincrement())
  name String
}
`);

      process.env.PRISMA_SCHEMA_ENGINE_BINARY = pkg.schemaEngineBinaryPath;
      process.env.PRISMA_QUERY_ENGINE_LIBRARY = pkg.queryEngineLibraryPath;

      execSync(
        "npx --yes prisma@5.1.1 db push --schema schema.prisma --skip-generate",
        { stdio: "inherit" },
      );
      execSync(
        "npx --yes prisma@5.1.1 generate --schema schema.prisma",
        { stdio: "inherit" },
      );

      const { PrismaClient } = require(path.join(dir, "client"));
      (async () => {
        const prisma = new PrismaClient();
        const w = await prisma.widget.create({ data: { name: "smoke-test" } });
        if (w.name !== "smoke-test") throw new Error("unexpected row: " + JSON.stringify(w));
        const found = await prisma.widget.findUnique({ where: { id: w.id } });
        if (!found || found.name !== "smoke-test") throw new Error("read-back failed");
        await prisma.$disconnect();
        console.log("OK: native OHOS query-engine + schema-engine work end to end");
      })();
    '
}

do_deps
do_fetch
do_build
do_package
do_test

echo "OK: @ohos-npm-ports/prisma-engines built and smoke-tested"
