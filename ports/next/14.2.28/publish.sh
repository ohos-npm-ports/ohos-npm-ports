#!/bin/sh
set -e

cd "$(dirname "$0")/next-swc-openharmony-arm64"
npm publish --tag legacy-14 --access public

cd ../next-14.2.28
npm publish --tag legacy-14 --access public
