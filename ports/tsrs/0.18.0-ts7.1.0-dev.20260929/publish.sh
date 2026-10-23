#!/bin/sh
set -e
cd "$(dirname "$0")/build/native"
npm publish --tag latest --access public
cd ../main
npm publish --tag latest --access public
