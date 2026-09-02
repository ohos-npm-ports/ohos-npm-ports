FROM ghcr.io/hqzing/dockerharmony:6.1

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
    brew install -y node python devel-base git rust rustup bash openssh && \
    echo 'alias ls="ls --color=auto"' >> /root/.mkshrc && \
    echo 'alias grep="grep --color=auto"' >> /root/.mkshrc && \
    cp /root/.mkshrc /root/.bashrc

# 将 rustup 路径加入 PATH
ENV PATH="/storage/Users/currentUser/.harmonybrew/opt/rustup/bin:${PATH}"

WORKDIR /root

CMD ["/bin/sh"]
