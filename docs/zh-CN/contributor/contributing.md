# 贡献指南

本仓库把 npm 三方包移植到 OpenHarmony。新增包先看下面的准入规则和 [port-spec.md](port-spec.md)；选择移植路径见 [porting-guide.md](porting-guide.md)。完整命令行用法见 [cli.md](cli.md)，提交前的自检见 [verification.md](verification.md)，CI 门禁见 [../maintainer/ci-pipeline.md](../maintainer/ci-pipeline.md)。

## 准入规则

- 优先级永远是“上游原生支持 > 官方社区 fork/port > 本仓库临时收录”。添加包之前先确认上游没有已经计划或进行中的适配 PR。
- 移植不能破坏其他平台行为；只能在鸿蒙上使用的包无法支撑真实生产工程。
- 发布包名一律 `@ohos-npm-ports/<name>`，版本一律 `<上游版本>-<修订号>`。NPMBUILD 的 revision 从 1 起，允许在上游版本不变时迭代移植修复；构建脚本和补丁只使用裸上游 version，修订号仅由 `npm-ports pack` 注入。
- 不得改动原作者与开源许可证信息。

## 开发环境：必须在容器里做

为了让本地环境和流水线一致，构建和调试应在 ci-runner 容器内完成：

```sh
docker pull ghcr.io/ohos-npm-ports/ci-runner:latest
docker run -itd --name=ohos ghcr.io/ohos-npm-ports/ci-runner:latest
docker exec -it ohos sh
git clone https://github.com/ohos-npm-ports/ohos-npm-ports.git
cd ohos-npm-ports
export PATH="$PWD/cli:$PATH"
npm-ports pack ports/<port>
```

- 若 GHCR 访问不通，可把 `ghcr.io` 换成 `ghcr.nju.edu.cn`。
- 镜像源码见 [`docker/Dockerfile`](../../../docker/Dockerfile)，建议工作前拉取最新镜像。
- 使用 arm64 原生硬件；x86_64 指令翻译不适合这些编译任务。
- 网络需要访问 GitHub 和 npm registry。

## Fork 与 PR 流程

1. Fork 本仓库并在个人仓启用 Actions。
2. 参照同类包的 `NPMBUILD` 生命周期钩子和 patches 编写移植；目录、版本线、revision 和槽位规范见 [port-spec.md](port-spec.md)。
3. 在容器内构建并完成 [verification.md](verification.md) 的验证。
4. 推到个人仓，确认 CI 的构建和临时 Verdaccio 通过。个人仓没有中心仓 NPM_TOKEN，不应进入正式发布步骤。
5. 提 PR 到本仓库。合并后流水线自动构建并发布，无需人工执行 npm publish。

新建配方可执行 `npm-ports create <upstream> [--set-name <port>] [--set-version <version>] [--no-fetch]`。默认从 npm registry 获取最新版本和 tarball 并计算 SHA-256；scoped 上游按既定规则生成扁平短名，可用 `--set-name` 覆盖。`--no-fetch` 不访问 registry，版本和摘要留待手工填写。生成后自动打开编辑器；已有 port 不会被覆盖。

定位并修改配方可执行 `npm-ports edit <port>`，命令使用 `VISUAL` 或 `EDITOR` 指定的编辑器（默认 vim）打开对应的 NPMBUILD，无需手工查找路径。

上游版本升级可用 `npm-ports bump <port> --write`；只修移植问题时用 `npm-ports revision <port>` 增加修订号。两者都必须经过真实构建，不能只改元数据后直接合并。

## Commit 规范

只对改动了 `ports/**` 的 commit 生效：

- 新增 port：`<port>: add port <version>`
- 版本升级：`<port>: bump to <version> ...` 或仅修订时 `<port>: bump port revision to <version>`
- 修复/整理：`<port>: <具体做了什么>`

PR 的 lint-commits 会检查这些提交并在失败时给出具体原因。
