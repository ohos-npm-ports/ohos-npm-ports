#!/bin/sh
set -e

# 槽位包先发，主包 optionalDependencies 才能装上即解析。
# 第一条 cd 为产物目录行，须自包含定位（$(dirname "$0") 前缀）。
cd "$(dirname "$0")/build/typescript-openharmony-arm64"
npm publish --tag latest --access public

cd ../typescript-7.0.2
npm publish --tag latest --access public
