#!/bin/sh
set -e

cd "ast-grep-napi-0.45.3"

npm publish --tag latest --access public
