#!/bin/sh
set -e

cd "ast-grep-napi-0.43.0"

npm publish --tag latest --access public
