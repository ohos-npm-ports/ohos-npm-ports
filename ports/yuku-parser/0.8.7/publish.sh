#!/bin/sh
set -e

cd "yuku-parser-0.8.7"

npm publish --tag legacy-0.8 --access public
