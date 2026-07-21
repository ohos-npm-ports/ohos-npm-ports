#!/bin/sh
set -e

source ../../../setup-env.sh

cd node-sqlite3-5.1.7
npm stage publish --tag latest --access public
