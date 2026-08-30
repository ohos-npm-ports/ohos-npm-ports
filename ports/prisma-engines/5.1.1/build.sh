#!/bin/sh
set -e

# Native build of the prisma-engines commit prisma@5.1.1 pins
# (query-engine N-API library + schema-engine CLI) for OpenHarmony.
# @prisma/get-platform never detects this platform, so consumers point
# PRISMA_QUERY_ENGINE_LIBRARY / PRISMA_SCHEMA_ENGINE_BINARY at these
# binaries directly (see index.js).

COMMIT=6a3747c37ff169c90047725a05a6ef02e32ac97e
PKG=prisma-engines

# Official rust dist, not brew's bottle: the bottle's sysroot is newer than
# the CI container's libc, so its products reference __fd_chk and fail to
# load there. LIBZ_SYS_STATIC: nothing provides libz.so at runtime either.
brew install -y openssl@3 libxml2 zlib
RUST_DIST=2026-08-20
RUST_VER=1.98.0
CURL="curl -fsSL --retry 8 --retry-all-errors --connect-timeout 30 --speed-limit 10240 --speed-time 30"
$CURL "https://static.rust-lang.org/dist/${RUST_DIST}/rust-${RUST_VER}-aarch64-unknown-linux-ohos.tar.gz" -o rust-dist.tar.gz
echo "db1b3c28a89a71594e9366b952ea5b34f7f9c66c853db7c3c637e59906cfcbc0  rust-dist.tar.gz" | sha256sum -c -
mkdir -p rust-dist-extract
tar -zxf rust-dist.tar.gz -C rust-dist-extract --strip-components=1
rm rust-dist.tar.gz
RUST_HOME="$(pwd)/rust-dist"
sh rust-dist-extract/install.sh --prefix="${RUST_HOME}" --disable-ldconfig \
  --components=rustc,cargo,rust-std-aarch64-unknown-linux-ohos
rm -rf rust-dist-extract
export PATH="${RUST_HOME}/bin:$PATH"
# cargo verifies TLS against the system trust store, which is empty here.
export LD_LIBRARY_PATH="$(brew --prefix openssl@3)/lib:$(brew --prefix libxml2)/lib:$(brew --prefix zlib)/lib"
export CARGO_HTTP_CAINFO="$(brew --prefix)/etc/openssl@3/cert.pem"
export LIBZ_SYS_STATIC=1
cargo --version

$CURL "https://github.com/prisma/${PKG}/archive/${COMMIT}.tar.gz" -o src.tar.gz
tar -zxf src.tar.gz
rm src.tar.gz
mv "${PKG}-${COMMIT}" src
cd src
patch -p1 < ../patchs/0001-workspace-config-ohos.patch
patch -p1 < ../patchs/0002-rustc-compat-fixes.patch
patch -p1 < ../patchs/0005-build-rs-no-git-required.patch
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
(cd vendor/socket2-0.4.7 && patch -p1 < ../../../patchs/0003-socket2-ohos-target.patch)
grep -q 'target_env = "ohos"' vendor/socket2-0.4.7/src/sys/unix.rs

$CURL "https://static.crates.io/crates/openssl-src/openssl-src-111.25.0+1.1.1t.crate" -o openssl-src.crate
mkdir -p "vendor/openssl-src-111.25.0+1.1.1t"
tar -zxf openssl-src.crate -C "vendor/openssl-src-111.25.0+1.1.1t" --strip-components=1
rm openssl-src.crate
(cd "vendor/openssl-src-111.25.0+1.1.1t" && patch -p1 < ../../../patchs/0004-openssl-src-ohos-target.patch)
grep -q 'aarch64-unknown-linux-ohos' 'vendor/openssl-src-111.25.0+1.1.1t/src/lib.rs'

if ! curl -fsIL --max-time 8 -o /dev/null "https://index.crates.io/config.json" 2>/dev/null; then
  export CARGO_REGISTRIES_CRATES_IO_INDEX="sparse+https://rsproxy.cn/index/"
fi

# No pkg-config/OPENSSL_DIR wiring for the ohos target: build OpenSSL from
# source (first-class prisma-engines feature). The stub satisfies crt's
# reference to the __fd_chk hardening hook, which older container libcs do
# not export; on devices the real one is irrelevant either way.
printf 'void __fd_chk(long fd) { (void)fd; }\n' > fdchk-stub.c
cc -c fdchk-stub.c -o fdchk-stub.o
export RUSTFLAGS="-C link-arg=$PWD/fdchk-stub.o"

cargo build --release -p query-engine-node-api -p schema-engine-cli --features vendored-openssl

QE_SRC=target/release/libquery_engine.so
SE_SRC=target/release/schema-engine
[ -f "$QE_SRC" ] || { echo "query engine .so missing" >&2; exit 1; }
[ -f "$SE_SRC" ] || { echo "schema engine binary missing" >&2; exit 1; }
readelf -h "$QE_SRC" | grep -q 'AArch64'
readelf -h "$SE_SRC" | grep -q 'AArch64'

cd ..

rm -rf pkg
mkdir pkg
cp src/target/release/libquery_engine.so pkg/libquery_engine.so
cp src/target/release/schema-engine pkg/schema-engine
cp package.json pkg/package.json
cp index.js pkg/index.js

# binary-sign-tool is device-only (fails to relocate in this container).
# selfsign.py refuses files that already carry a .codesign section, which
# LLD stamps at link time -- so strip first (ports/turbo does the same).
llvm-strip --strip-all pkg/libquery_engine.so
llvm-strip --strip-all pkg/schema-engine
curl -fsSL "https://raw.githubusercontent.com/hqzing/ohos-bst-light/main/selfsign.py" -o selfsign.py
python3 selfsign.py pkg/libquery_engine.so
chmod +x pkg/libquery_engine.so
python3 selfsign.py pkg/schema-engine
chmod +x pkg/schema-engine
rm selfsign.py
readelf -S pkg/libquery_engine.so | grep -q '\.codesign'
readelf -S pkg/schema-engine | grep -q '\.codesign'

# Alias names matching get-platform's binaryTarget fallback ("debian-openssl-
# 1.1.x" on openharmony; the 3.0.x pair guards against libssl-probe drift).
# prisma's engine lookup (resolveBinary / generate's copy) scans getEnginesPath
# = the package root for exactly these names, so overrides of @prisma/engines
# work without env vars.
ln -s libquery_engine.so pkg/libquery_engine-debian-openssl-1.1.x.so
ln -s schema-engine pkg/schema-engine-debian-openssl-1.1.x
ln -s libquery_engine.so pkg/libquery_engine-debian-openssl-3.0.x.so
ln -s schema-engine pkg/schema-engine-debian-openssl-3.0.x

# @prisma/engines compatibility surface (for the overrides route): the prisma
# CLI accesses exactly these 4 symbols plus the default constant.
node -e '
  const e = require("./pkg/index.js");
  for (const k of ["getEnginesPath", "ensureBinariesExist", "getCliQueryEngineBinaryType", "enginesVersion", "DEFAULT_CLI_QUERY_ENGINE_BINARY_TYPE"]) {
    if (e[k] === undefined) { console.error("missing compat export: " + k); process.exit(1); }
  }
  const p = e.getEnginesPath();
  for (const f of ["libquery_engine-debian-openssl-1.1.x.so", "schema-engine-debian-openssl-1.1.x"]) {
    require("fs").accessSync(require("path").join(p, f));
  }
  console.log("OK: @prisma/engines compatibility surface present at " + p);
'
# Real functional smoke: db push + generate + a PrismaClient round-trip.
node -e '
  const path = require("path");
  const { execSync } = require("child_process");
  const fs = require("fs");
  const os = require("os");

  const pkg = require("./pkg/index.js");
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

echo "OK: @ohos-npm-ports/prisma-engines built and smoke-tested"
