#!/bin/sh
set -e

# Zero-compile repack: @playwright/mcp is a thin launcher — cli.js/index.js
# only require playwright-core/lib/{coreBundle,utilsBundle}, where all tool
# implementations live. The OHOS surface is entirely the dependency: the
# playwright-core slot is aliased to this repo's source-built core port
# (ArkWeb launch flow + HDC backend). Upstream's full-playwright dependency is
# never imported (only the two playwright-core requires above) and is dropped,
# otherwise it would pull unpatched upstream playwright into the tree.
#
# 0.0.78 is the newest stable pinning the 1.62 lineage (0.0.79 pins
# 1.63.0-alpha; upstream has no 1.63 stable yet, same lineage as core port
# 1.62.1-1).

VERSION=0.0.78
PKG=playwright-mcp
ROOT="$(pwd)"

# Large downloads intermittently stall or die mid-transfer on some networks.
CURL="curl -fsSL --retry 8 --retry-all-errors --connect-timeout 30 --speed-limit 10240 --speed-time 30"

$CURL "https://registry.npmjs.org/@playwright/mcp/-/mcp-${VERSION}.tgz" -o mcp.tgz
tar -zxf mcp.tgz
rm mcp.tgz
mv package "${PKG}-${VERSION}"

cd "${PKG}-${VERSION}"
patch -p1 < ../patchs/0001-update-package-json.patch

# --- verify package contents ---

NAME=$(node -e "console.log(require('./package.json').name)")
[ "$NAME" = "@ohos-npm-ports/playwright-mcp" ]

node -e '
  const pkg = require("./package.json");
  if (pkg.version !== "0.0.78-1") throw new Error(`bad version: ${pkg.version}`);
  if (pkg.dependencies["playwright-core"] !== "npm:@ohos-npm-ports/playwright-core@1.62.1-1")
    throw new Error(`playwright-core not aliased: ${pkg.dependencies["playwright-core"]}`);
  if ("playwright" in pkg.dependencies) throw new Error("unused playwright dep must be dropped");
  console.log("package.json rewrite OK");
'

node --check cli.js
node --check index.js

# published artifact must stay pure JS — no ELF needing a signature
ELFS=$(find . -type f -exec sh -c 'od -An -tx1 -N4 "$1" | grep -q "7f 45 4c 46"' _ {} \; -print)
[ -z "$ELFS" ] || { echo "unexpected ELF files in artifact:" $ELFS >&2; exit 1; }

# --- functional smoke test as a consumer ---
# npm pack first: a file: install of a *directory* is symlinked and its
# dependencies are NOT installed; a tarball install resolves them normally.
cd "${ROOT}/${PKG}-${VERSION}"
npm pack --ignore-scripts > /dev/null
mv "ohos-npm-ports-${PKG}-${VERSION}-1.tgz" "${ROOT}/"

cd "${ROOT}"
mkdir smoke
cd smoke
echo '{"name":"playwright-mcp-smoke","private":true}' > package.json
npm install --no-audit --no-fund --ignore-scripts "file:../ohos-npm-ports-${PKG}-${VERSION}-1.tgz"

node -e '
  const core = require("playwright-core/package.json");
  if (core.name !== "@ohos-npm-ports/playwright-core")
    throw new Error(`playwright-core slot resolved to ${core.name}`);
  if (core.version !== "1.62.1-1") throw new Error(`core version: ${core.version}`);
  console.log("alias slot OK:", core.name, core.version);
'

MCP="node_modules/@ohos-npm-ports/playwright-mcp"
node "$MCP/cli.js" --version | grep -q "Version 0.0.78"
node "$MCP/cli.js" --help > /dev/null

node -e '
  const { tools } = require("playwright-core/lib/coreBundle");
  const names = tools.browserTools.map(t => t.schema?.name ?? t.name).filter(Boolean);
  for (const need of ["browser_navigate", "browser_click", "browser_snapshot", "browser_take_screenshot", "browser_evaluate"])
    if (!names.includes(need)) throw new Error(`missing tool: ${need}`);
  console.log("coreBundle tools OK:", names.length, "browser tools");
'

node -e '
  const mcp = require("@ohos-npm-ports/playwright-mcp");
  if (typeof mcp.createConnection !== "function") throw new Error("createConnection missing");
  console.log("index.js require OK");
'

# stdio MCP handshake (the default transport): initialize + tools/list exercise
# the real server loop — this package *is* an MCP server.
node -e '
  const { spawn } = require("node:child_process");
  const path = require("node:path");
  const pkgJson = require.resolve("@ohos-npm-ports/playwright-mcp/package.json");
  const child = spawn(process.execPath, [path.join(path.dirname(pkgJson), "cli.js")], { stdio: ["pipe", "pipe", "inherit"] });
  let buf = "";
  const results = [];
  const fail = (m) => { console.error(m); child.kill(); process.exit(1); };
  child.stdout.on("data", (c) => {
    buf += c.toString("utf8");
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      results.push(msg);
      if (results.length === 1) {
        if (msg.id !== 1 || !msg.result) fail("bad initialize response: " + line);
        console.log("stdio initialize OK:", msg.result.serverInfo?.name, msg.result.serverInfo?.version);
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
      } else {
        const names = (msg.result?.tools ?? []).map(t => t.name);
        if (msg.id !== 2 || names.length === 0) fail("bad tools/list response: " + line);
        for (const need of ["browser_navigate", "browser_snapshot", "browser_take_screenshot"])
          if (!names.includes(need)) fail("missing MCP tool: " + need);
        console.log("stdio tools/list OK:", names.length, "tools");
        child.kill();
        process.exit(0);
      }
    }
  });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "port-smoke", version: "0" } } }) + "\n");
  setTimeout(() => fail("handshake timeout"), 30000);
'

cd "${ROOT}"
rm -rf smoke

echo "OK: @ohos-npm-ports/playwright-mcp ${VERSION}-1 repacked"
