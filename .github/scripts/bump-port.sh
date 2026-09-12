#!/bin/bash
# port 目录改写器：ports/<port>/<from>/ → ports/<port>/<to>/（版本串改写 + port 修订重置为 -1）。
# 纯文件操作，不碰 git——commit/push 由上层 autobump.sh 负责；因此可在任意 cwd 沙箱里独立测试。
#
# 用法：bump-port.sh <port> <from> <to> [--dry-run]
#   --dry-run：在临时目录里演算，diff 打到 stdout，仓库不留痕迹（白名单准入判据，见设计文档 §六）。
#
# 改写规则（版本敏感，勿放宽）：
# 1. build.sh / publish.sh 全局 s/<from>/<to>/g（版本串只出现在 URL/tag/目录名/资产名）；
# 2. build.sh / patchs/* 里带修订的版本串 "<to>-N"/"<to>_N" 归一为 "<to>-1"（port 修订每次 bump 重置）；
# 3. patchs/* 里的 package.json 版本改写行 '"version": "<from>"' 与 '"version": "<from>[-_]N"'
#    一律改写为 '"version": "<to>-1"'——sqlite3 补丁里是 "5.1.7-8" 这种带修订形态，精确匹配才覆盖得到；
#    禁止对 patch hunk 其余内容做盲目 sed（hunk 行号/上下文版本敏感，改坏会静默打不上，herdr 教训同源）。
# 4. 落盘校验：新目录内 grep -F "<from>" 必须零命中；sh -n 语法自检。
# 已知盲区：若 build.sh 内嵌旧版本源码包的 sha256，全局 sed 换不掉校验和 → build 失败，被 validate 拦下（非静默）。
set -euo pipefail

PORT="${1:?usage: bump-port.sh <port> <from> <to> [--dry-run]}"
FROM="${2:?}"
TO="${3:?}"
DRY=false
[ "${4:-}" = "--dry-run" ] && DRY=true

[ -d "ports/$PORT/$FROM" ] || { echo "error: ports/$PORT/$FROM not found" >&2; exit 1; }
if [ "$DRY" = false ] && [ -e "ports/$PORT/$TO" ]; then
  echo "error: ports/$PORT/$TO already exists" >&2; exit 1
fi

edit_dir() { # $1 = 目标目录（原地改写）
  local d="$1" f
  for f in "$d"/*.sh; do
    [ -f "$f" ] || continue
    # 带右边界（后随字符非数字）：防 0.5.8 ⊂ 0.5.80 类数字尾巴误伤；点号放行（.tgz 等扩展名）
    sed -i "s/$FROM\([^0-9]\)/$TO\1/g; s/$FROM$/$TO/" "$f"
    # 带修订的版本串归一为 -1（nx 类 build.sh 内联 version 改写场景）
    sed -i -E "s/\"${TO}[-_][0-9]+\"/\"$TO-1\"/g" "$f"
  done
  if [ -d "$d/patchs" ]; then
    for f in "$d/patchs"/*; do
      [ -f "$f" ] || continue
      # 结构性路径：npm workspace 的 directory 字段等嵌在补丁里的 port 目录路径
      sed -i "s|ports/$PORT/$FROM|ports/$PORT/$TO|g" "$f"
      # package.json 版本行，两种形态分开改写：
      #   裸版本（pristine/- 行）→ "$TO"——必须等于新上游源码里的真实版本，hunk 才打得上；
      #   带修订（port/+ 行）  → "$TO-1"——port 修订每次 bump 重置。
      sed -i -E "s/\"version\": \"${FROM}[-_][0-9]+\"/\"version\": \"$TO-1\"/g" "$f"
      sed -i -E "s/\"version\": \"$FROM\"/\"version\": \"$TO\"/g" "$f"
      # v 前缀引用（tag/文案，如 "cross-compiled from upstream v0.5.8 source"），
      # 同样带右边界；刻意不给 patchs 加裸版本 catch-all——那会把兄弟子包依赖 pin
      # （@<ver>-N 形态）静默洗白成错误版本，这类残留必须 fail-loud 留给人工
      sed -i "s/v$FROM\([^0-9]\)/v$TO\1/g; s/v$FROM$/v$TO/" "$f"
    done
  fi
}

verify_dir() { # $1 = 目标目录；零残留 + 语法自检（残留用 mktemp，勿依赖可写 /tmp）
  local d="$1" rf
  rf=$(mktemp)
  if grep -rn -F "$FROM" "$d" >"$rf" 2>&1; then
    echo "error: rewrite left '$FROM' residue:" >&2
    cat "$rf" >&2; rm -f "$rf"
    return 1
  fi
  rm -f "$rf"
  local f
  for f in "$d"/*.sh; do
    [ -f "$f" ] || continue
    sh -n "$f" || { echo "error: syntax check failed: $f" >&2; return 1; }
  done
}

DEST="ports/$PORT/$TO"
if [ "$DRY" = true ]; then
  WORK=$(mktemp -d)
  cp -a "ports/$PORT/$FROM" "$WORK/$TO"
  ( cd "$WORK" && edit_dir "$TO" && verify_dir "$TO" )
  diff -ru "ports/$PORT/$FROM" "$WORK/$TO" || true
  rm -rf "$WORK"
  echo "-- dry-run ok: $PORT $FROM → $TO --"
else
  cp -a "ports/$PORT/$FROM" "$DEST"
  edit_dir "$DEST"
  verify_dir "$DEST"
  echo "ok: $PORT $FROM → $TO"
fi
