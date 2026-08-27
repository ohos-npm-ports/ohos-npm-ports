#!/bin/sh
set -e

cd resvg-js-2.6.2

npm publish --ignore-scripts --tag latest --access public
