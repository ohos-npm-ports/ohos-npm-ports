#!/bin/sh
set -e

cd "yuku-codegen-0.5.44"

if npm view @ohos-npm-ports/yuku-codegen version >/dev/null 2>&1; then
  npm stage publish --tag latest --access public
else
  npm publish --tag latest --access public
fi
