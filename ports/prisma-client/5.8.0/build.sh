#!/bin/sh
set -e

# ============================================================
# ohos-npm-ports: @ohos-npm-ports/prisma-client 5.8.0-1
#
# 构建方式：
#   1. 下载官方 @prisma/client@5.8.0 tarball，打 patch：manifest 改写
#      （name/version/repository），delta 自证
#   2. 零编译重打包：除被 patch 的 package.json 外每个文件与 pristine
#      上游树逐字节对账（补丁只允许碰指定文件的不变量）
#   3. npm pack 成 tarball 后做 drop-in 冒烟（node + bun 双运行时）
#
# The client is pure JS; on OpenHarmony it works unmodified once engines come
# from @ohos-npm-ports/prisma-engines via the @ohos-npm-ports/prisma CLI
# override (see ports/prisma/5.1.1).
# ============================================================

PKG_NAME="prisma-client"
PKG_VERSION="5.8.0"
PORTS_VERSION="5.8.0-1"
WORK_DIR="$(pwd)"
BUILD_DIR="${WORK_DIR}/build"

CURL="curl -fsSL --retry 8 --retry-all-errors --connect-timeout 30 --speed-limit 10240 --speed-time 30"

# ===== fetch =====
do_fetch() {
    echo "=== fetch: 官方 @prisma/client@${PKG_VERSION} ==="
    rm -rf "${BUILD_DIR}"
    mkdir -p "${BUILD_DIR}"
    cd "${BUILD_DIR}"
    $CURL "https://registry.npmjs.org/@prisma/client/-/client-${PKG_VERSION}.tgz" -o src.tgz
    echo "61398ed8615cf6ab560c4aaf88499ed83a559f0d941cc8c1b43f66cebe93dfc4  src.tgz" | sha256sum -c -
    tar -zxf src.tgz
    rm src.tgz
    mv package src
    # record pristine hashes before any modification, for the post-assembly diff
    (cd src && find . -type f -exec sha256sum {} + | sort) > pristine.sha256
}

# ===== build =====
do_build() {
    echo "=== build: 打 manifest patch + grep marker ==="
    cd "${BUILD_DIR}/src"
    patch -p1 < "${WORK_DIR}/patchs/0001-update-package-json.patch"
    # toybox patch can silently no-op on a malformed header; assert it landed.
    grep -q '"name": "@ohos-npm-ports/prisma-client"' package.json
    grep -q '"version": "5.8.0-1"' package.json
}

# ===== package =====
do_package() {
    echo "=== package: 组装发布目录 + pristine 对账 + npm pack ==="
    rm -rf "${BUILD_DIR}/pkg"
    mkdir "${BUILD_DIR}/pkg"
    (cd "${BUILD_DIR}/src" && tar -zcf - . | tar -zxf - -C "${BUILD_DIR}/pkg")
    rm -rf "${BUILD_DIR}/pkg/node_modules"

    cd "${BUILD_DIR}"
    # integrity: every shipped file must be byte-identical to the pristine
    # upstream tree except the patched manifest -- this also enforces that the
    # patch touches nothing else
    (cd pkg && find . -path ./package.json -prune -o -type f -exec sha256sum {} + | sort) > built.sha256
    grep -v '  \./package.json$' pristine.sha256 > pristine-no-manifest.sha256
    cmp pristine-no-manifest.sha256 built.sha256
    rm pristine.sha256 pristine-no-manifest.sha256 built.sha256
    node -e '
      const p = require("'"${BUILD_DIR}"'/pkg/package.json");
      if (p.name !== "@ohos-npm-ports/prisma-client" || p.version !== "5.8.0-1") { console.error("bad manifest"); process.exit(1); }
      const { execSync } = require("child_process");
      for (const f of ["index.js", "runtime/library.js", "generator-build/index.js", "scripts/postinstall.js"]) {
        require("fs").accessSync(require("path").join("'"${BUILD_DIR}"'/pkg", f));
        execSync("node --check " + JSON.stringify(require("path").join("'"${BUILD_DIR}"'/pkg", f)));
      }
      console.log("OK: manifest + entry files parse");
    '
    (cd pkg && npm pack --ignore-scripts >/dev/null && mv ohos-npm-ports-prisma-client-5.8.0-1.tgz "${BUILD_DIR}")
    test -f "${BUILD_DIR}/ohos-npm-ports-prisma-client-5.8.0-1.tgz"
}

# ===== test =====
do_test() {
    # Drop-in smoke on the real machine: all three overrides, no PRISMA_* env vars.
    # client 5.8.0 asks for engine version 5.8.0-37.* while the engines port ships
    # the 5.1.1-pinned commit, so this also exercises the version-agnostic local
    # engine resolution of the prisma CLI port.
    SMOKE="${BUILD_DIR}/.smoke"
    rm -rf "$SMOKE"
    mkdir -p "$SMOKE/app"
    cat > "$SMOKE/package.json" <<EOF
{
  "name": "prisma-client-port-smoke",
  "private": true,
  "dependencies": {
    "@prisma/client": "file:${BUILD_DIR}/ohos-npm-ports-prisma-client-5.8.0-1.tgz",
    "prisma": "npm:@ohos-npm-ports/prisma@5.1.1-1"
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
    # bun runtime; the ci-runner image ships no bun -- gate it and cover bun on a real device
    if command -v bun >/dev/null 2>&1; then
      rm -rf client dev.db
      bun "$SMOKE_ABS/node_modules/prisma/build/index.js" db push --schema schema.prisma --skip-generate 2>&1 | grep -q 'database is now in sync' || { echo "bun db push failed" >&2; exit 1; }
      bun "$SMOKE_ABS/node_modules/prisma/build/index.js" generate --schema schema.prisma 2>&1 | grep -q 'Generated Prisma Client' || { echo "bun generate failed" >&2; exit 1; }
      bun -e "$CRUD"
    fi
    ENGINE="$(ls client/libquery_engine-*.so.node)"
    readelf -h "$ENGINE" | grep -q 'AArch64'
    readelf -S "$ENGINE" | grep -q '\.codesign'

    cd "${BUILD_DIR}"
    rm -rf "$SMOKE" ohos-npm-ports-prisma-client-5.8.0-1.tgz
}

do_fetch
do_build
do_package
do_test

echo "OK: @ohos-npm-ports/prisma-client built and smoke-tested"
