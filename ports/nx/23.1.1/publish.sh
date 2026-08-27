#!/bin/sh
set -e

cd nx-23.1.1
# --ignore-scripts: build.sh already did all the work (cargo build, tsc
# compile, patches, signing); the upstream postinstall is a try/catch no-op.
npm publish --ignore-scripts --tag latest --access public
