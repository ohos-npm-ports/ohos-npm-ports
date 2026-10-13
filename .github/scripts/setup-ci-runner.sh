#!/bin/sh
set -eu
export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_INSTALL_CLEANUP=1
brew update
if [ -n "$(brew outdated --quiet node)" ]; then
  brew upgrade --overwrite node
fi
sh .github/scripts/ci-time-service-compat.sh
if [ -d /system/lib64/ndk ]; then
  export LD_LIBRARY_PATH="/system/lib64/ndk${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi
printf 'Consumer library search path: %s\n' "${LD_LIBRARY_PATH:-<default>}"
for directory in /system/lib64/ndk /system/lib64 "$(brew --prefix)/opt/ohos-sdk/native/sysroot/usr/lib/aarch64-linux-ohos"; do
  if [ -f "$directory/libtime_service_ndk.so" ]; then
    ls -l "$directory/libtime_service_ndk.so"
    readelf -d "$directory/libtime_service_ndk.so" | grep -E 'NEEDED|SONAME' || true
  fi
done
node --version
