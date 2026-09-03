#!/bin/sh
set -e

cd "$(dirname "$0")/parcel-watcher-openharmony-arm64-2.5.1"
npm publish --tag latest --access public
