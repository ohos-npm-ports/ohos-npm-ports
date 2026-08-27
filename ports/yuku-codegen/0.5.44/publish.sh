#!/bin/sh
set -e

cd "yuku-codegen-0.5.44"

npm publish --tag latest --access public
