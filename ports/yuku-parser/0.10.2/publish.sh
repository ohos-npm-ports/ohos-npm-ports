#!/bin/sh
set -e

cd "yuku-parser-0.10.2"

npm publish --tag latest --access public
