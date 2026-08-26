#!/bin/sh
set -e

cd "napi-rs-tar-1.1.0"

if npm view @ohos-npm-ports/napi-rs-tar version >/dev/null 2>&1; then
  npm stage publish --tag latest --access public
else
  npm publish --tag latest --access public
fi
