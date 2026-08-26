#!/bin/sh
set -e

cd "napi-rs-lzma-1.4.5"

if npm view @ohos-npm-ports/napi-rs-lzma version >/dev/null 2>&1; then
  npm stage publish --tag latest --access public
else
  npm publish --tag latest --access public
fi
