#!/bin/sh
set -e

cd build/typescript-7.0.2
npm publish --tag latest --access public
