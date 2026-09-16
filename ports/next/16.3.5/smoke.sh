#!/bin/sh
# 消费侧冒烟：双包各自 pack 成 tgz 装进干净工程，再从主包 loader 的解析上下文
# require.resolve 槽位包，断言解析到已安装的 .node。
# 槽位包 main 是 OHOS 的 .node，其 dlopen 依赖 HarmonyOS 系统库，容器内不做加载验证
# （真机验证不在 CI 范围）；ELF/接线断言由 build.sh do_test 覆盖。
# cwd = 槽位包目录（publish.sh 第一条 cd 的产物目录）。
set -eu

SLOT_DIR="$(pwd)"
MAIN_DIR="$(dirname "$PWD")/next-16.3.5"
NODE=next-swc.openharmony-arm64.node
SLOT_PKG="@ohos-npm-ports/next-swc-openharmony-arm64"

TGZ="$(npm pack --silent --ignore-scripts | tail -1)"
[ -f "${TGZ}" ] || { echo "error: npm pack produced nothing" >&2; exit 1; }
MAIN_TGZ="$(cd ../next-16.3.5 && npm pack --silent --ignore-scripts | tail -1)"
MAIN_TGZ="$(cd ../next-16.3.5 && pwd)/${MAIN_TGZ}"
SCRATCH="$(mktemp -d)"
trap 'rm -f "${SLOT_DIR}/${TGZ}" "${MAIN_TGZ}"; rm -rf "${SCRATCH}"' EXIT

cd "${SCRATCH}"
npm init -y >/dev/null
# --force：槽位包 os/cpu 限定 openharmony/arm64，容器（linux）上直装会被
# EBADPLATFORM 拦下；一次性 scratch 无副作用
npm install --no-audit --no-fund --ignore-scripts --force \
    "${SLOT_DIR}/${TGZ}" "${MAIN_TGZ}" >/dev/null

RESOLVED=$(node -e '
  const { createRequire } = require("node:module");
  const req = createRequire(process.argv[1] + "/");
  console.log(req.resolve(process.argv[2] + "/package.json"));
' "${SCRATCH}/node_modules/@ohos-npm-ports/next/dist/build/swc" "${SLOT_PKG}")
case "${RESOLVED}" in
  */node_modules/"${SLOT_PKG}"/package.json) ;;
  *) echo "error: slot resolved to ${RESOLVED}, expected the installed slot package" >&2; exit 1 ;;
esac
test -s "$(dirname "${RESOLVED}")/${NODE}" || { echo "error: resolved slot package has no ${NODE}" >&2; exit 1; }

echo "OK: smoke passed (双包安装 + 主包 loader 上下文解析到槽位包)"
