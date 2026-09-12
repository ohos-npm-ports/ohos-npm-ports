#!/bin/sh
# port 预验证（阶段 2/3，DockerHarmony 容器内跑——容器没有 bash，本脚本必须保持 POSIX sh）：
# 跑 build.sh + 默认冒烟（npm pack → 安装 → require 加载）。
# 必须在仓库根运行；ci-runner 镜像自带全套工具链，无需任何 setup 脚本
# （与上游 ci.yml 现行 Build 步骤同构：cd 目录 && ./build.sh）。
#
# 用法：validate-port.sh <port> <ver>
#
# 冒烟定位（tap「brew test 真跑二进制」原则的 port 版）：
# - 从 publish.sh 的 cd 行定位构建产物目录，npm pack 出 tgz，装进 scratch 工程，
#   package.json 有 main/exports 就真 require（addon 走 dlopen）；无入口则只验证安装成功。
# - port 目录可放可选 smoke.sh 覆盖默认冒烟（cwd = 产物目录，失败即验证失败）。
# - 盲区：容器验证 ≠ 真机 HarmonyOS 签名/沙箱行为（容器结果不是部署证明）；真机复测建议不阻塞。
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

# 定位产物目录（publish.sh 的 cd 目标；build.sh 产出后 publish.sh 直接进去发包）
PKGDIR=$(sed -n 's/^cd //p' publish.sh | head -1)
[ -n "$PKGDIR" ] || { echo "error: cannot parse build dir from publish.sh 'cd' line" >&2; exit 1; }
[ -d "$PKGDIR" ] || { echo "error: build dir '$PKGDIR' does not exist after build.sh" >&2; exit 1; }

PORTDIR="$PWD"
cd "$PKGDIR"

# 可选 per-port 冒烟覆盖：smoke.sh 放 port 版本目录，以产物目录为 cwd 运行
if [ -f "$PORTDIR/smoke.sh" ]; then
  echo "-- running per-port smoke.sh --"
  "$PORTDIR/smoke.sh"
  echo "== validate ok (per-port smoke): $PORT $VER =="
  exit 0
fi

TGZ=$(npm pack --silent | tail -1)
[ -f "$TGZ" ] || { echo "error: npm pack produced nothing" >&2; exit 1; }

SCRATCH=$(mktemp -d)
(
  cd "$SCRATCH" || exit 1
  npm init -y >/dev/null
  npm install --no-audit --no-fund "$PORTDIR/$PKGDIR/$TGZ" >/dev/null
  # 找安装进来的顶层包（跳过 dotfiles 与 scoped 前缀目录本身）
  NAME=$(node -e '
    const fs = require("fs");
    const mods = [];
    for (const d of fs.readdirSync("node_modules", { withFileTypes: true })) {
      if (!d.isDirectory() || d.name.startsWith(".")) continue;
      if (d.name.startsWith("@")) {
        for (const n of fs.readdirSync("node_modules/" + d.name, { withFileTypes: true })) {
          if (n.isDirectory()) mods.push(d.name + "/" + n.name);
        }
      } else mods.push(d.name);
    }
    console.log(mods.join("\n"));' | head -1)
  [ -n "$NAME" ] || { echo "error: nothing installed into node_modules" >&2; exit 1; }
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
rm -f "$TGZ"

echo "== validate ok: $PORT $VER =="
