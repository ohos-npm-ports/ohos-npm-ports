#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SLOT_DIR="$ROOT/next-swc-openharmony-arm64"
cd "$SLOT_DIR"
NODE=next-swc.openharmony-arm64.node
SLOT_PKG="@ohos-npm-ports/next-swc-openharmony-arm64"

TGZ="$(npm pack --silent --ignore-scripts | tail -1)"
[ -f "${TGZ}" ] || { echo "error: npm pack produced nothing" >&2; exit 1; }
MAIN_TGZ="$(cd ../next-14.2.28 && npm pack --silent --ignore-scripts | tail -1)"
MAIN_TGZ="$(cd ../next-14.2.28 && pwd)/${MAIN_TGZ}"
SCRATCH="$(mktemp -d)"
trap 'rm -f "${SLOT_DIR}/${TGZ}" "${MAIN_TGZ}"; rm -rf "${SCRATCH}"' EXIT

cd "${SCRATCH}"
npm init -y >/dev/null
npm install --no-audit --no-fund --ignore-scripts --force \
  "${SLOT_DIR}/${TGZ}" >/dev/null
mkdir -p node_modules/next
tar -xzf "${MAIN_TGZ}" --strip-components=1 -C node_modules/next

RESOLVED=$(node -e '
  const { createRequire } = require("node:module");
  const req = createRequire(process.argv[1] + "/");
  console.log(req.resolve(process.argv[2] + "/package.json"));
' "${SCRATCH}/node_modules/next/dist/build/swc" "${SLOT_PKG}")
case "${RESOLVED}" in
  */node_modules/"${SLOT_PKG}"/package.json) ;;
  *) echo "error: slot resolved to ${RESOLVED}, expected the installed slot package" >&2; exit 1 ;;
esac
test -s "$(dirname "${RESOLVED}")/${NODE}"
node <<'NODE'
const assert = require("node:assert/strict");
assert.equal(process.platform, "openharmony");
const mainPackage = require("next/package.json");
assert.equal(mainPackage.version, "14.2.28-1");
const slot = require("@ohos-npm-ports/next-swc-openharmony-arm64");
assert.equal(typeof slot.transformSync, "function");
const swc = require("next/dist/build/swc");
const triples = swc.getSupportedArchTriples();
assert.equal(triples.openharmony.arm64[0].platformArchABI, "openharmony-arm64");
swc.loadBindings().then((bindings) => {
  assert.equal(bindings.isWasm, false);
  console.log("OK: SWC loader selected the native OpenHarmony binding");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
NODE

echo "OK: smoke passed (packed main package resolves the OpenHarmony slot)"
