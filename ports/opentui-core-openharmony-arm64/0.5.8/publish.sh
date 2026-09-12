#!/bin/sh
set -e

cd "$(dirname "$0")/opentui-core-openharmony-arm64-0.5.8"

npm publish --tag latest --access public
