#!/bin/bash
# livecheck 等价物：逐个 port 比对「上游 npm 最新版」与「上游 main 里 port 目录的最新版本」。
# 输出 TSV：port \t max_dir_ver \t upstream_ver \t status \t allowlisted
#   status ∈ current | behind | ahead | hold | manual-scheme | unconfigured
#          | missing-upstream | prerelease-skipped | check-failed
#
# 设计要点（docs/ohos-npm-ports-autobump.md §五）：
# - 比对基准 = 上游仓 main 的目录树（UPSTREAM_REF），不是 fork main——fork 滞后不产生重复候选；
# - registry.npmmirror.com 优先 + 重试（官方 registry 对 CI runner IP 有 CF 挑战，tap 2026-08-23 实录）；
#   候选（behind）产生时直连官方 registry 复核，两边不一致以官方为准（镜像同步延迟防误报）；
#   查询失败轮空置 check-failed，不报错退出——误报会变成 PR 骚扰，延迟一轮无害；
# - $() 赋值内的 curl|jq 必须内部 `|| true`：set -euo pipefail 下网络抖动会杀死在赋值处。
#
# 用法：check-upstream-versions.sh [ONLY_PORT]   （在仓库根运行；依赖 git/jq/node/curl）
set -euo pipefail

INDEX="${INDEX:-.github/scripts/ports-index.json}"
UPSTREAM_REF="${UPSTREAM_REF:-origin/main}"
ONLY="${1:-}"

[ -f "$INDEX" ] || { echo "index not found: $INDEX" >&2; exit 1; }

# 无依赖 semver 比较：输出 -1/0/1（a<b / a=b / a>b）。支持 prerelease（含数字/字母混合标识符），
# 忽略 build 元数据。容器内置 node，勿用 sort -V（prerelease 语义不准）。
semver_cmp() {
  node -e '
    const cmp = (a, b) => {
    const p = (s) => {
      s = s.replace(/^v/, "").split("+")[0];
      const [core, pre] = s.split("-", 2);
      const nums = core.split(".").map((x) => parseInt(x, 10) || 0);
      return { n: nums, p: pre ? pre.split(".") : null };
    };
    const id = (x) => (/^\d+$/.test(x) ? [0, parseInt(x, 10)] : [1, x]);
    const [A, B] = process.argv.slice(1).map(p);
    for (let i = 0; i < 3; i++) {
      if ((A.n[i] || 0) !== (B.n[i] || 0)) return (A.n[i] || 0) < (B.n[i] || 0) ? -1 : 1;
    }
    if (A.p === null && B.p === null) return 0;
    if (A.p === null) return 1;   // 正式版 > 预发布
    if (B.p === null) return -1;
    for (let i = 0; i < Math.max(A.p.length, B.p.length); i++) {
      const x = A.p[i], y = B.p[i];
      if (x === undefined) return -1;
      if (y === undefined) return 1;
      const [xt, xv] = id(x), [yt, yv] = id(y);
      if (xt !== yt) return xt < yt ? -1 : 1;
      if (xv !== yv) return xv < yv ? -1 : 1;
    }
    return 0;
    };
    console.log(cmp(process.argv[2], process.argv[3]));
  ' "$1" "$2"
}

# 某 port 目录在上游 main 下的最大版本号（空 = 尚未合并）
max_dir_ver() {
  git ls-tree --name-only "$UPSTREAM_REF" "ports/$1/" 2>/dev/null \
    | sed 's|.*/||' | while IFS= read -r v; do
        [ -n "$v" ] && echo "$v"
      done | sort -t. -k1,1n -k2,2n -k3,3n | tail -1 || true
}

# 查 dist-tag：$1=包名 $2=registry 基址；失败输出空（不抛错）
fetch_tag() {
  curl -fsSL -S --retry 3 --retry-delay 2 --connect-timeout 20 \
    "$1" 2>/dev/null | jq -r --arg t "$2" '.["dist-tags"][$t] // empty' || true
}

# 注意：字段分隔符必须是非空白字符（'|'）——bash/zsh 的 read 对 IFS 空白字符（含 \t）
# 会把连续分隔符折叠成一个，null upstream/tag 产生的空字段会导致整体左移（实测踩坑）
jq -r '.ports[]
  | [.port, (.upstream // ""), (.tag // ""), (.allowlisted // false | tostring),
     (.hold // false | tostring), (.scheme // "npm")] | join("|")' "$INDEX" |
while IFS='|' read -r PORT PKG TAG ALLOWED HOLD SCHEME; do
  [ -z "$ONLY" ] || [ "$PORT" = "$ONLY" ] || continue
  MAX=$(max_dir_ver "$PORT")

  if [ "$HOLD" = "true" ]; then
    printf '%s\t%s\t\t%s\t%s\n' "$PORT" "$MAX" "hold" "$ALLOWED"; continue
  fi
  if [ "$SCHEME" != "npm" ]; then
    printf '%s\t%s\t\t%s\t%s\n' "$PORT" "$MAX" "manual-scheme" "$ALLOWED"; continue
  fi
  if [ -z "$PKG" ] || [ -z "$TAG" ]; then
    printf '%s\t%s\t\t%s\t%s\n' "$PORT" "$MAX" "unconfigured" "$ALLOWED"; continue
  fi
  if [ -z "$MAX" ]; then
    printf '%s\t\t\t%s\t%s\n' "$PORT" "missing-upstream" "$ALLOWED"; continue
  fi

  VER=$(fetch_tag "https://registry.npmmirror.com/$PKG" "$TAG")
  if [ -z "$VER" ]; then
    printf '%s\t%s\t\t%s\t%s\n' "$PORT" "$MAX" "check-failed" "$ALLOWED"; continue
  fi

  # 预发布版本：有 prerelease_filter 且命中才跟踪，否则跳过
  case "$VER" in
    *-*)
      FILTER=$(jq -r --arg p "$PORT" '.ports[] | select(.port == $p) | .prerelease_filter // ""' "$INDEX")
      if [ -z "$FILTER" ] || ! grep -qE "$FILTER" <<< "$VER"; then
        printf '%s\t%s\t%s\t%s\t%s\n' "$PORT" "$MAX" "$VER" "prerelease-skipped" "$ALLOWED"; continue
      fi
      ;;
  esac

  C=$(semver_cmp "$VER" "$MAX")
  if [ "$C" -le 0 ]; then
    # ahead = port 目录比 dist-tag 还新（跟踪线分叉的信号），仅报告不动作
    STATUS=$([ "$C" -eq 0 ] && echo "current" || echo "ahead")
    printf '%s\t%s\t%s\t%s\t%s\n' "$PORT" "$MAX" "$VER" "$STATUS" "$ALLOWED"; continue
  fi

  # 候选：官方 registry 复核，不一致以官方为准（防镜像延迟/漂移）
  OFFICIAL=$(fetch_tag "https://registry.npmjs.org/$PKG" "$TAG")
  if [ -n "$OFFICIAL" ] && [ "$OFFICIAL" != "$VER" ]; then
    VER="$OFFICIAL"
    C=$(semver_cmp "$VER" "$MAX")
    if [ "$C" -le 0 ]; then
      printf '%s\t%s\t%s\t%s\t%s\n' "$PORT" "$MAX" "$VER" "current" "$ALLOWED"; continue
    fi
  fi
  printf '%s\t%s\t%s\t%s\t%s\n' "$PORT" "$MAX" "$VER" "behind" "$ALLOWED"
done
