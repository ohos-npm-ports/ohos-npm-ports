#!/bin/sh
set -e

cd build/pkg

npm publish --tag latest --access public
