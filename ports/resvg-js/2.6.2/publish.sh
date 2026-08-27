#!/bin/sh
set -e

cd resvg-js-2.6.2

# --ignore-scripts: build.sh 已完成全部准备工作（cargo build、patch、签名），
# 跳过 prepublishOnly（napi prepublish — napi-rs 不支持 openharmony）。
# npm stage publish 要求包已存在（首次发布 404），按存在性路由首发
if npm view @ohos-npm-ports/resvg-resvg-js version >/dev/null 2>&1; then
  npm stage publish --ignore-scripts --tag latest --access public
else
  npm publish --ignore-scripts --tag latest --access public
fi
