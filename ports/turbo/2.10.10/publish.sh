#!/bin/sh
set -e

cd turbo-2.10.10

npm publish --tag latest --access public
