#!/bin/sh
set -e
cd build/nw-0.119.2
npm publish --tag latest --access public
