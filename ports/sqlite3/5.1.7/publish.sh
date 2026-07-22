#!/bin/sh
set -e

cd node-sqlite3-5.1.7
npm stage publish --tag latest --access public
