#!/bin/sh
set -e

# ============================================================
# ohos-npm-ports: @ohos-npm-ports/prisma 5.1.1-1
#
# 构建方式：
#   1. 下载官方 prisma@5.1.1 tarball，打 patch：openharmony 上 engines
#      从 @prisma/engines 包根本地解析（npm override 到
#      @ohos-npm-ports/prisma-engines），而非 binaries.prisma.sh 下载
#   2. 零编译重打包：上游全部内容（patch 过的 manifest 在内）进发布目录
#   3. npm pack 成 tarball 后做 drop-in 冒烟（node + bun 双运行时）
#
# binaries.prisma.sh has no OHOS builds and would serve platform-mismatched
# debian glibc binaries.
# ============================================================

PKG_NAME="prisma"
PKG_VERSION="5.1.1"
PORTS_VERSION="5.1.1-1"
WORK_DIR="$(pwd)"
BUILD_DIR="${WORK_DIR}/build"

CURL="curl -fsSL --retry 8 --retry-all-errors --connect-timeout 30 --speed-limit 10240 --speed-time 30"

# ===== fetch =====
do_fetch() {
    echo "=== fetch: 官方 prisma@${PKG_VERSION} ==="
    rm -rf "${BUILD_DIR}"
    mkdir -p "${BUILD_DIR}"
    cd "${BUILD_DIR}"
    $CURL "https://registry.npmjs.org/${PKG_NAME}/-/${PKG_NAME}-${PKG_VERSION}.tgz" -o src.tgz
    echo "82290a4f68947526fbfea3a924d8ae91b9b7e6080b708d98db8bae188aa949b1  src.tgz" | sha256sum -c -
    tar -zxf src.tgz
    rm src.tgz
    mv package src
}

# ===== build =====
do_build() {
    echo "=== build: 打 patch + grep marker + 跨平台回归 ==="
    cd "${BUILD_DIR}/src"
    patch -p1 < "${WORK_DIR}/patchs/0001-openharmony-local-engines.patch"
    patch -p1 < "${WORK_DIR}/patchs/0002-update-package-json.patch"
    # toybox patch can silently no-op on a malformed header; assert both landed.
    grep -q 'async function ohosLocalEngines' build/index.js
    grep -q 'process.platform === "openharmony" ? (await ohosLocalEngines(downloadParams))' build/index.js
    grep -q '"name": "@ohos-npm-ports/prisma"' package.json
    grep -q '"version": "5.1.1-1"' package.json
    node --check build/index.js

    # Cross-platform regression: the non-openharmony branch must be the untouched
    # upstream download() call, so linux/darwin/win32 consumers keep stock behavior.
    node -e '
      const fs = require("fs");
      const src = fs.readFileSync("build/index.js", "utf8");
      const n = src.split(": await download(downloadParams);").length - 1;
      if (n !== 2) { console.error("expected 2 gated download call sites, found " + n); process.exit(1); }
      const i = src.indexOf("async function ohosLocalEngines");
      const j = src.indexOf("async function getBinaryPathsByVersion");
      if (i < 0 || j < 0 || i > j) { console.error("helper not defined before its callers"); process.exit(1); }
      console.log("OK: non-openharmony branch routes to upstream download()");
    '
}

# ===== package =====
do_package() {
    echo "=== package: 组装发布目录 + manifest 断言 + npm pack ==="
    rm -rf "${BUILD_DIR}/pkg"
    mkdir "${BUILD_DIR}/pkg"
    # everything upstream ships, minus install-time state (the port manifest is
    # already patched in place by 0002)
    (cd "${BUILD_DIR}/src" && tar -zcf - . | tar -zxf - -C "${BUILD_DIR}/pkg")
    rm -rf "${BUILD_DIR}/pkg/node_modules"

    node -e '
      const p = require("'"${BUILD_DIR}"'/pkg/package.json");
      if (p.name !== "@ohos-npm-ports/prisma" || p.version !== "5.1.1-1") { console.error("bad manifest"); process.exit(1); }
      console.log("OK: manifest");
    '
    # file: dir installs symlink and breaks the consumer'"'"'s node_modules walk-up;
    # install the packed tarball instead
    (cd "${BUILD_DIR}/pkg" && npm pack --ignore-scripts >/dev/null && mv ohos-npm-ports-prisma-5.1.1-1.tgz "${BUILD_DIR}")
    test -f "${BUILD_DIR}/ohos-npm-ports-prisma-5.1.1-1.tgz"
}

# ===== test =====
do_test() {
    # Drop-in smoke on the real machine: overrides only, no PRISMA_* env vars.
    # npm install-scripts stay disabled so the flow is deterministic.
    SMOKE="${BUILD_DIR}/.smoke"
    rm -rf "$SMOKE"
    mkdir -p "$SMOKE/app"
    cat > "$SMOKE/package.json" <<EOF
{
  "name": "prisma-port-smoke",
  "private": true,
  "dependencies": {
    "prisma": "file:${BUILD_DIR}/ohos-npm-ports-prisma-5.1.1-1.tgz",
    "@prisma/client": "5.1.1"
  },
  "overrides": {
    "@prisma/engines": "npm:@ohos-npm-ports/prisma-engines@5.1.1-3"
  }
}
EOF
    cat > "$SMOKE/app/schema.prisma" <<'EOF'
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
EOF

    SMOKE_ABS="$(cd "$SMOKE" && pwd)"
    cd "$SMOKE"
    npm install --ignore-scripts --no-audit --no-fund
    cd app

    CRUD='const { PrismaClient } = require("./client");
(async () => {
  const p = new PrismaClient();
  const w = await p.widget.create({ data: { name: "smoke" } });
  const f = await p.widget.findUnique({ where: { id: w.id } });
  if (!f || f.name !== "smoke") throw new Error("read-back failed");
  const n = await p.widget.count();
  if (n !== 1) throw new Error("bad count: " + n);
  await p.$disconnect();
  console.log("CRUD OK");
})().catch((e) => { console.error(e.message); process.exit(1); });'

    # node runtime
    "$SMOKE_ABS/node_modules/.bin/prisma" db push --schema schema.prisma --skip-generate 2>&1 | grep -q 'database is now in sync' || { echo "db push failed" >&2; exit 1; }
    "$SMOKE_ABS/node_modules/.bin/prisma" generate --schema schema.prisma 2>&1 | grep -q 'Generated Prisma Client' || { echo "generate failed" >&2; exit 1; }
    node -e "$CRUD"
    # bun runtime (the generated client must dlopen the OHOS engine under bun too);
    # the ci-runner image ships no bun -- gate it and cover bun on a real device
    if command -v bun >/dev/null 2>&1; then
      rm -rf client dev.db
      bun "$SMOKE_ABS/node_modules/prisma/build/index.js" db push --schema schema.prisma --skip-generate 2>&1 | grep -q 'database is now in sync' || { echo "bun db push failed" >&2; exit 1; }
      bun "$SMOKE_ABS/node_modules/prisma/build/index.js" generate --schema schema.prisma 2>&1 | grep -q 'Generated Prisma Client' || { echo "bun generate failed" >&2; exit 1; }
      bun -e "$CRUD"
    fi
    # the engine that landed in the generated client must be the OHOS one (signed,
    # AArch64, .codesign section), not a downloaded debian glibc binary
    ENGINE="$(ls client/libquery_engine-*.so.node)"
    readelf -h "$ENGINE" | grep -q 'AArch64'
    readelf -S "$ENGINE" | grep -q '\.codesign'

    cd "${BUILD_DIR}"
    rm -rf "$SMOKE" ohos-npm-ports-prisma-5.1.1-1.tgz
}

do_fetch
do_build
do_package
do_test

echo "OK: @ohos-npm-ports/prisma built and smoke-tested"
