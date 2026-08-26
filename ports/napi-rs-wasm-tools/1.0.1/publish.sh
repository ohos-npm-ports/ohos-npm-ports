#!/bin/sh
set -e

cd "napi-rs-wasm-tools-1.0.1"

if npm view @ohos-npm-ports/napi-rs-wasm-tools version >/dev/null 2>&1; then
  npm stage publish --tag latest --access public
else
  npm publish --tag latest --access public
fi
