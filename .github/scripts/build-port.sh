#!/bin/sh
# Builds and checks one port inside the ci-runner container.
# Everything that shapes the built output lives here and in cli/, so editing ci.yml alone does not rebuild ports.
set -eu

# Avoid implicit upgrades during NPMBUILD builds and prefer brew rust,
# whose toolchain includes the OpenHarmony host target.
export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_INSTALL_UPGRADE=1
brew update
PATH="$(brew --prefix rust)/bin:$PATH"
export PATH
exec cli/npm-ports check "$1"
