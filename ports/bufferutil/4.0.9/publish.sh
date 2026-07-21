#!/bin/sh
set -e

source ../../../setup-env.sh

cd bufferutil-4.0.9
npm stage publish --tag latest --access public
