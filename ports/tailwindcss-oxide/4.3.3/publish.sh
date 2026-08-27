#!/bin/sh
set -e

cd src/crates/node/npm/openharmony-arm64
npm publish --tag latest --access public || true
cd ../..

npm publish --tag latest --access public
