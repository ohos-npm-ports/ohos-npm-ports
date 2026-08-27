#!/bin/sh
set -e

cd pprof-5.17.0


# npm stage publish 要求包已存在（首次发布 404），按存在性路由首发
if npm view @ohos-npm-ports/datadog-pprof version >/dev/null 2>&1; then
  npm stage publish --tag latest --access public
else
  npm publish --tag latest --access public
fi
