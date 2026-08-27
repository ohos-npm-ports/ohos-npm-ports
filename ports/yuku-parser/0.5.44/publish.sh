#!/bin/sh
set -e

cd "yuku-parser-0.5.44"

npm publish --tag latest --access public
