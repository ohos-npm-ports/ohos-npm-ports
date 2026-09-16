#!/bin/sh
set -e

cd build/pkg

npm publish --ignore-scripts --tag latest --access public
