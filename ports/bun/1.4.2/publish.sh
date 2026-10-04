#!/bin/sh
set -e

# 槽位包先发，主包 optionalDependencies 才能装上即解析。
cd build/oven-bun-openharmony-arm64
npm publish --tag latest --access public

cd ../bun-wrapper-1.4.2
npm publish --tag latest --access public
