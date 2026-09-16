#!/bin/sh
set -e

# 槽位包先发，主包 optionalDependencies 才能装上即解析。
cd "$(dirname "$0")/build/typescript-native-preview-openharmony-arm64"
npm publish --tag latest --access public

cd ../typescript-native-preview-7.0.0-dev.20260707.2
npm publish --tag latest --access public
