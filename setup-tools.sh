#!/bin/sh
set -e

# 安装 Harmonybrew
curl -fLO https://github.com/Harmonybrew/ohos-zsh/releases/download/5.9/zsh-5.9-ohos-arm64.tar.gz
tar -zxf zsh-5.9-ohos-arm64.tar.gz -C /opt
ln -s /opt/zsh-5.9-ohos-arm64/bin/zsh /usr/bin/zsh
zsh -c "$(curl -fsSL https://harmonybrew.atomgit.com/install.sh)"
export PATH=/storage/Users/currentUser/.harmonybrew/bin:$PATH

# 安装 node 和开发工具
brew install node python devel-base
