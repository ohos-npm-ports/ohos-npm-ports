#!/bin/sh
set -e

cd opentui-core-0.4.5

# npm stage publish 要求包已存在（首次发布 404），按存在性路由首发
if npm view @ohos-npm-ports/opentui-core version >/dev/null 2>&1; then
  npm stage publish --tag latest --access public
else
  npm publish --tag latest --access public
fi
