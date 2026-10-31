FROM ghcr.io/hqzing/dockerharmony:7.0

ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

# brew shellenv 变量
ENV PATH="/storage/Users/currentUser/.harmonybrew/bin:/storage/Users/currentUser/.harmonybrew/sbin:${PATH}"
ENV HOMEBREW_PREFIX="/storage/Users/currentUser/.harmonybrew"
ENV HOMEBREW_CELLAR="/storage/Users/currentUser/.harmonybrew/Cellar"
ENV HOMEBREW_REPOSITORY="/storage/Users/currentUser/.harmonybrew/Homebrew"
ENV INFOPATH="/storage/Users/currentUser/.harmonybrew/share/info"

RUN curl -fLO https://github.com/Harmonybrew/ohos-zsh/releases/download/5.9/zsh-5.9-ohos-arm64.tar.gz && \
    tar -zxf zsh-5.9-ohos-arm64.tar.gz -C /opt && \
    rm zsh-5.9-ohos-arm64.tar.gz && \
    ln -s /opt/zsh-5.9-ohos-arm64/bin/zsh /usr/bin/zsh && \
    zsh -c "$(curl -fsSL https://harmonybrew.atomgit.com/install.sh)" && \
    brew install -y gawk && \
    brew install -y node python@3.14 devel-base git rust bash openssh ohos-selfsign && \
    echo 'alias ls="ls --color=auto"' >> /root/.mkshrc && \
    echo 'alias grep="grep --color=auto"' >> /root/.mkshrc && \
    cp /root/.mkshrc /root/.bashrc

ENV HOMEBREW_NO_INSTALL_UPGRADE="1"

# 预置时间服务桩，使容器环境更接近真机。
RUN <<'EOF'
set -eu
mkdir -p /system
if [ ! -e /system/lib64 ]; then
  ln -s /lib64 /system/lib64
fi
mkdir -p /system/lib64/ndk
cat > /tmp/time_service.c <<'C_EOF'
#include <stdint.h>
#include <stdio.h>
uint32_t OH_TimeService_GetTimeZone(char *timeZone, uint32_t len) {
    if (timeZone != 0 && len > 0) {
        snprintf(timeZone, len, "Asia/Shanghai");
    }
    return 0;
}
C_EOF
clang -shared -fPIC /tmp/time_service.c -o /system/lib64/ndk/libtime_service_ndk.so
rm /tmp/time_service.c
EOF

WORKDIR /root

CMD ["/bin/sh"]
