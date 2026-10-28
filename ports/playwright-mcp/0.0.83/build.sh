#!/bin/sh
set -e

VERSION=0.0.83
PKG=playwright-mcp
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT="$SCRIPT_DIR/build"
mkdir -p "$ROOT"
cd "$ROOT"

CURL="curl -fsSL --retry 8 --retry-all-errors --connect-timeout 30 --speed-limit 10240 --speed-time 30"

do_fetch() {
  cd "$ROOT"
  $CURL "https://registry.npmjs.org/@playwright/mcp/-/mcp-${VERSION}.tgz" -o mcp.tgz
  echo "f0014a13361b1ee2d8607a4e187868ab9a6e8ac637dbcd66e4af43f738d0c8cb  mcp.tgz" | sha256sum -c -
  rm -rf package "${PKG}-${VERSION}"
  tar -zxf mcp.tgz
  rm mcp.tgz
  mv package "${PKG}-${VERSION}"
  node -e 'const fs=require("fs"),crypto=require("crypto");const p=process.argv[1];const hashes=Object.fromEntries(fs.readdirSync(p).filter(f=>f!=="package.json").map(f=>[f,crypto.createHash("sha256").update(fs.readFileSync(p+"/"+f)).digest("hex")]));fs.writeFileSync("upstream-hashes.json",JSON.stringify(hashes))' "$ROOT/${PKG}-${VERSION}"

}

do_build() {
  cd "$ROOT/${PKG}-${VERSION}"
  patch -p1 < "$SCRIPT_DIR"/patchs/0001-update-package-json.patch

}

do_test() {
  cd "$ROOT/${PKG}-${VERSION}"
  node -e 'const fs=require("fs"),crypto=require("crypto"),assert=require("assert/strict");for(const [f,hash] of Object.entries(JSON.parse(fs.readFileSync("../upstream-hashes.json"))))assert.equal(crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex"),hash,f)'
  NAME=$(node -e "console.log(require('./package.json').name)")
  [ "$NAME" = "@ohos-npm-ports/playwright-mcp" ]

  node -e '
    const pkg = require("./package.json");
    if (pkg.version !== "0.0.83-1") throw new Error(`bad version: ${pkg.version}`);
    if (pkg.dependencies["playwright-core"] !== "npm:@ohos-npm-ports/playwright-core@1.64.1-1")
      throw new Error(`playwright-core not aliased: ${pkg.dependencies["playwright-core"]}`);
    if ("playwright" in pkg.dependencies) throw new Error("unused playwright dep must be dropped");
    console.log("package.json rewrite OK");
  '

  node --check cli.js
  node --check index.js

  ELFS=$(find . -type f -exec sh -c 'od -An -tx1 -N4 "$1" | grep -q "7f 45 4c 46"' _ {} \; -print)
  [ -z "$ELFS" ] || { echo "unexpected ELF files in artifact:" $ELFS >&2; exit 1; }

  cd "${ROOT}/${PKG}-${VERSION}"
  npm pack --ignore-scripts > /dev/null
  mv "ohos-npm-ports-${PKG}-${VERSION}-1.tgz" "${ROOT}/"

  cd "${ROOT}"
  rm -rf smoke
  mkdir smoke
  cd smoke
  echo '{"name":"playwright-mcp-smoke","private":true}' > package.json
  if [ -n "${PLAYWRIGHT_CORE_TARBALL:-}" ]; then
    node -e 'require("fs").writeFileSync("package.json", JSON.stringify({name:"playwright-mcp-smoke",private:true,overrides:{"playwright-core":"file:"+process.env.PLAYWRIGHT_CORE_TARBALL}}))'
  fi
  npm install --no-audit --no-fund --ignore-scripts "file:../ohos-npm-ports-${PKG}-${VERSION}-1.tgz"

  node -e '
    const core = require("playwright-core/package.json");
    if (core.name !== "@ohos-npm-ports/playwright-core")
      throw new Error(`playwright-core slot resolved to ${core.name}`);
    if (core.version !== "1.64.1-1") throw new Error(`core version: ${core.version}`);
    console.log("alias slot OK:", core.name, core.version);
  '

  MCP="node_modules/@ohos-npm-ports/playwright-mcp"
  node "$MCP/cli.js" --version | grep -q "Version 0.0.83"
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

}

do_fetch
do_build
do_test
echo "OK: @ohos-npm-ports/playwright-mcp ${VERSION}-1 repacked"
