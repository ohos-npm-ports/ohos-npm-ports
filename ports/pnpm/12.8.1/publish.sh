#!/bin/sh
set -e

# 槽位包先发，主包 optionalDependencies 才能装上即解析。
cd build/pnpm-exe.openharmony-arm64
npm publish --tag latest --access public

cd ../pnpm-wrapper-12.8.1
npm publish --tag latest --access public
