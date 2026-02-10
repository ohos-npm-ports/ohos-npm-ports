#!/bin/sh

# 虽然多数变量并非强依赖，但全量声明可规避不同工程下的工具链隐患，故采取冗余配置以换取更广泛的场景适用性
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
