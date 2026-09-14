#!/bin/sh
# port 预验证（阶段 2/3，DockerHarmony 容器内跑——容器没有 bash，本脚本必须保持 POSIX sh）：
# 跑 build.sh + 默认冒烟（npm pack → 安装 → require 加载）。
# 必须在仓库根运行；ci-runner 镜像自带全套工具链，无需任何 setup 脚本
# （与上游 ci.yml 现行 Build 步骤同构：cd 目录 && ./build.sh）。
#
# 用法：validate-port.sh <port> <ver>
#
# 从 publish.sh 的 cd 行定位构建产物目录，npm pack 出 tgz，装进临时工程；
# package.json 有 main/exports 就加载入口。port 目录可放 smoke.sh 覆盖默认检查。
set -eu

PORT="${1:?usage: validate-port.sh <port> <ver>}"
VER="${2:?}"
DIR="ports/$PORT/$VER"

[ -d "$DIR" ] || { echo "error: $DIR not found" >&2; exit 1; }
[ -f "$DIR/build.sh" ] || { echo "error: $DIR/build.sh not found" >&2; exit 1; }

echo "== validate: $PORT $VER =="
cd "$DIR"

if command -v timeout >/dev/null 2>&1; then
  timeout 1800 ./build.sh
else
  ./build.sh
fi
echo "-- build ok --"

# 定位产物目录（publish.sh 的 cd 目标；build.sh 产出后 publish.sh 直接进去发包）。
# eval 整行而不是死抠字面量文本——平台槽位包的 cd 目标可以是
# `cd "$(dirname "$0")/<pkg>-<ver>"` 这类表达式（parcel-watcher-openharmony-arm64
# 先例，opentui-core-openharmony-arm64 沿用），不是纯字面量路径；$0 显式绑定成
# publish.sh 自身路径，跟它被真实调用时看到的 $0 一致。PKGDIR 落地成绝对路径。
CDLINE=$(sed -n 's/^cd //p' publish.sh | head -1)
[ -n "$CDLINE" ] || { echo "error: cannot parse build dir from publish.sh 'cd' line" >&2; exit 1; }
PKGDIR=$(sh -c "cd $CDLINE >/dev/null 2>&1 && pwd" './publish.sh' 2>/dev/null)
[ -n "$PKGDIR" ] && [ -d "$PKGDIR" ] || { echo "error: build dir from 'cd $CDLINE' does not exist after build.sh" >&2; exit 1; }

PORTDIR="$PWD"
cd "$PKGDIR"
PKG_NAME=$(node -p 'require("./package.json").name')

# 可选 per-port 冒烟覆盖：smoke.sh 放 port 版本目录，以产物目录为 cwd 运行
if [ -f "$PORTDIR/smoke.sh" ]; then
  echo "-- running per-port smoke.sh --"
  "$PORTDIR/smoke.sh"
  echo "== validate ok (per-port smoke): $PORT $VER =="
  exit 0
fi

TGZ=$(npm pack --silent --ignore-scripts | tail -1)
[ -f "$TGZ" ] || { echo "error: npm pack produced nothing" >&2; exit 1; }
TGZ="$PKGDIR/$TGZ"
# 清理挂 EXIT trap（而非只在成功路径最后 rm）：失败提前 exit 时也不留残留 tgz；
# TGZ 落地成绝对路径（PKGDIR 已绝对化）是因为 cwd 在这条路径构造后还会再变。
trap 'rm -f "$TGZ"' EXIT

SCRATCH=$(mktemp -d)
(
  cd "$SCRATCH" || exit 1
  npm init -y >/dev/null
  npm install --no-audit --no-fund --ignore-scripts "$TGZ" >/dev/null
  # Use the package name from the artifact rather than whichever dependency
  # npm happened to place first in node_modules.
  NAME="$PKG_NAME"
  [ -f "node_modules/$NAME/package.json" ] || { echo "error: target package was not installed: $NAME" >&2; exit 1; }
  HAS_ENTRY=$(node -e '
    const p = require("./node_modules/" + process.argv[1] + "/package.json");
    console.log(p.main || p.exports ? "yes" : "no");' "$NAME")
  if [ "$HAS_ENTRY" = "yes" ]; then
    node -e "require(process.argv[1]); console.log('require ok')" "$NAME"
  else
    echo "no main/exports entry, install-only smoke"
  fi
) || { echo "error: smoke failed for $PORT $VER" >&2; rm -rf "$SCRATCH"; exit 1; }
rm -rf "$SCRATCH"

echo "== validate ok: $PORT $VER =="
