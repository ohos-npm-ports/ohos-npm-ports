#!/bin/sh
set -e

cd "yuku-parser-0.7.0"

npm publish --tag latest --access public
