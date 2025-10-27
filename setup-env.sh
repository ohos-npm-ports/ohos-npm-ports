#!/bin/sh
export PATH=$PATH:/opt/node-v24.2.0-openharmony-arm64/bin # node、npm 在这里面
export PATH=$PATH:/opt/python/bin                         # python 在这里面
export PATH=$PATH:/opt/ohos-sdk/ohos/native/llvm/bin      # clang、clang++ 等在这里面
export PATH=$PATH:/opt/ohos-sdk/ohos/toolchains/lib       # binary-sign-tool 在这里面
export AS=llvm-as
export CC=clang
export CXX=clang++
export LD=ld.lld
export STRIP=llvm-strip
export RANLIB=llvm-ranlib
export OBJDUMP=llvm-objdump
export OBJCOPY=llvm-objcopy
export NM=llvm-nm
export AR=llvm-ar
export CFLAGS="-fPIC -D__MUSL__=1"
export CXXFLAGS="-fPIC -D__MUSL__=1"
