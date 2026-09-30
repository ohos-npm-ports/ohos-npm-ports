#!/bin/sh
set -e

cd "yuku-parser-0.8.7"

npm publish --tag latest --access public
