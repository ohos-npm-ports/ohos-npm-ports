#!/bin/sh
# 消费侧冒烟：pack 主包 → 干净工程安装 → bin/tsc 真跑 typecheck。
# 槽位包二进制已由 build.sh do_test 直接真跑验证。
set -eu

MAIN_DIR="$(dirname "$PWD")/typescript-7.0.2"
MAIN_TGZ="$(cd "${MAIN_DIR}" && npm pack --silent --ignore-scripts | tail -1)"
MAIN_TGZ="${MAIN_DIR}/${MAIN_TGZ}"
SCRATCH="$(mktemp -d)"
trap 'rm -f "${MAIN_TGZ}"; rm -rf "${SCRATCH}"' EXIT

cd "${SCRATCH}"
npm init -y >/dev/null
npm install --no-audit --no-fund --ignore-scripts "${MAIN_TGZ}" >/dev/null

printf '{"compilerOptions":{"strict":true}}' > tsconfig.json
printf 'const n: number = "x";\n' > bad.ts

BIN="${SCRATCH}/node_modules/.bin/tsc"
[ -x "${BIN}" ] || { echo "error: tsc bin was not installed" >&2; exit 1; }
"${BIN}" --version
"${BIN}" --noEmit -p tsconfig.json > out.txt 2>&1 || true
grep -q 'error TS' out.txt || { cat out.txt >&2; exit 1; }

echo "OK: smoke passed (installed tsc reports the expected type error)"
