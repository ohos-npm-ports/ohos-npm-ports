#!/bin/sh
set -e

cd pkg

npm publish --ignore-scripts --tag latest --access public
