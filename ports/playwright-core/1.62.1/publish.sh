#!/bin/sh
set -e

cd playwright-core-1.62.1-2

npm publish --tag latest --access public
