#!/bin/sh
set -e

cd "yuku-codegen-0.9.3"

npm publish --tag legacy-0.9 --access public
