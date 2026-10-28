#!/bin/sh
set -e
cd build/playwright-mcp-0.0.83
npm publish --tag latest --access public
