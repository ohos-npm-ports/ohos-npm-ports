#!/bin/sh
set -e

cd bufferutil-4.0.9
npm stage publish --tag latest --access public
