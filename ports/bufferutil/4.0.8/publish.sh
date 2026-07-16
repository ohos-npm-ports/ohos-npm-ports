#!/bin/sh
set -e

source ../../../setup-env.sh

cd bufferutil-4.0.8
npm publish --tag 4.0.8-1 --access public
