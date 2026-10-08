#!/bin/sh
set -e

cd build/nx-22.0.3
npm publish --ignore-scripts --tag legacy-22 --access public
