#!/bin/sh
set -e

cd "yuku-codegen-0.8.7"

npm publish --tag latest --access public
