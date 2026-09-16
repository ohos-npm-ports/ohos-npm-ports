#!/bin/sh
# 消费侧冒烟：pack 主包 → 干净工程安装 → bin/tsgo 真跑 typecheck。
# tsgo 为静态 Go 二进制（无 INTERP），构建侧 do_test 已直接验证槽位包二进制。
set -eu

MAIN_DIR="$(dirname "$PWD")/typescript-native-preview-7.0.0-dev.20260707.2"
MAIN_TGZ="$(cd "${MAIN_DIR}" && npm pack --silent --ignore-scripts | tail -1)"
MAIN_TGZ="${MAIN_DIR}/${MAIN_TGZ}"
SCRATCH="$(mktemp -d)"
trap 'rm -f "${MAIN_TGZ}"; rm -rf "${SCRATCH}"' EXIT

cd "${SCRATCH}"
npm init -y >/dev/null
npm install --no-audit --no-fund --ignore-scripts "${MAIN_TGZ}" >/dev/null

printf '{"compilerOptions":{"strict":true}}' > tsconfig.json
printf 'const n: number = "x";\n' > bad.ts

BIN="${SCRATCH}/node_modules/.bin/tsgo"
[ -x "${BIN}" ] || { echo "error: tsgo bin was not installed" >&2; exit 1; }
"${BIN}" --version
"${BIN}" --noEmit -p tsconfig.json > out.txt 2>&1 || true
grep -q 'error TS2322' out.txt || { cat out.txt >&2; exit 1; }

echo "OK: smoke passed (installed tsgo reports the expected type error)"
