#!/bin/sh
set -e

cd "yuku-parser-0.8.3"

if npm view @ohos-npm-ports/yuku-parser version >/dev/null 2>&1; then
  npm stage publish --tag latest --access public
else
  npm publish --tag latest --access public
fi
