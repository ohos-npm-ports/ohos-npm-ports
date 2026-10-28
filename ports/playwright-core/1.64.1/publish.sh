#!/bin/sh
set -e
cd build/playwright-core-1.64.1-1
npm publish --tag latest --access public
