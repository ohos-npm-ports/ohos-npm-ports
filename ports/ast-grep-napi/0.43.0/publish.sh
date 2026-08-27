#!/bin/sh
set -e

cd "ast-grep-napi-0.43.0"

if npm view @ohos-npm-ports/ast-grep-napi version >/dev/null 2>&1; then
  npm stage publish --tag latest --access public
else
  npm publish --tag latest --access public
fi
