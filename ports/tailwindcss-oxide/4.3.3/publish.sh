#!/bin/sh
set -e

# 先发二进制子包，主包的 optionalDependency 立即可解析（同上游发布顺序）。
# 两个包对 @ohos-npm-ports scope 都是首次发布：npm stage publish 要求包已
# 存在（404），按存在性分别路由首发
SUB=@ohos-npm-ports/tailwindcss-oxide-openharmony-arm64
MAIN=@ohos-npm-ports/tailwindcss-oxide

cd src/crates/node/npm/openharmony-arm64
npm publish --tag latest --access public
cd ../..

npm publish --tag latest --access public
