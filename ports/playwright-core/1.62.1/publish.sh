#!/bin/sh
set -e

cd playwright-core-1.62.1-3

npm publish --tag latest --access public
