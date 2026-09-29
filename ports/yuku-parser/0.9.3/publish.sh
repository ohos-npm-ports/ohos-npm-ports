#!/bin/sh
set -e

cd "yuku-parser-0.9.3"

npm publish --tag latest --access public
