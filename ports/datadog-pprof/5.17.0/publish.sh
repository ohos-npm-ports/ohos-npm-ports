#!/bin/sh
set -e

cd datadog-pprof-5.17.0

npm publish --ignore-scripts --tag latest --access public
