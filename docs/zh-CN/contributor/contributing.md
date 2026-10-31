# 贡献指南

本仓库把 npm 三方包移植到 OpenHarmony。本文按一次普通贡献的顺序说明从准备环境到创建 PR 的流程。配方规范、命令用法和验证标准分别见 [NPMBUILD 配方规范](port-spec.md)、[npm-ports 命令行工具](cli.md) 和 [验证标准](verification.md)。

## 1. 确认贡献内容

新增包之前先确认符合准入规则：

- 优先级永远是“上游原生支持 > 官方社区 fork/port > 本仓库临时收录”。添加包之前先确认上游没有已经计划或进行中的适配 PR。
- 移植不能破坏其他平台行为。只能在鸿蒙上使用的包无法支撑真实生产工程。
- 不得改动原作者与开源许可证信息。

选择移植路径见 [移植路径判定](porting-guide.md)。发布包名、版本线、revision、槽位和 patch 的详细规则见 [NPMBUILD 配方规范](port-spec.md)。

## 2. 准备分支和开发环境

先 Fork 本仓库，再准备一个基于最新 `main` 的分支。构建和调试必须在 ci-runner 容器内完成：

```sh
docker pull ghcr.io/ohos-npm-ports/ci-runner:latest
docker run -itd --name=ohos ghcr.io/ohos-npm-ports/ci-runner:latest
docker exec -it ohos sh
git clone https://github.com/<你的账号>/ohos-npm-ports.git
cd ohos-npm-ports
git switch -c my-change
export PATH="$PWD/cli:$PATH"
```

- 若 GHCR 访问不通，可把 `ghcr.io` 换成 `ghcr.nju.edu.cn`。
- 镜像源码见 [`docker/Dockerfile`](../../../docker/Dockerfile)，建议工作前拉取最新镜像。
- 使用 arm64 原生硬件。x86_64 指令翻译不适合这些编译任务。
- 网络需要访问 GitHub 和 npm registry。

## 3. 编写或更新配方

根据贡献类型选择操作：

- **新增 port**：执行 `npm-ports create <upstream>` 生成骨架，再参照同类包完善 NPMBUILD 和 patches。
- **修改现有配方**：执行 `npm-ports edit <port>` 打开目标 NPMBUILD。
- **升级上游版本**：执行 `npm-ports bump <port> --write`，升级后按需重新生成补丁。
- **只修复移植问题**：执行 `npm-ports revision <port>` 增加修订号。

这些命令的参数和更新规则见 [npm-ports 命令行工具](cli.md)。新增或修改后的配方必须符合 [NPMBUILD 配方规范](port-spec.md)，不能只修改元数据后直接提交。

## 4. 完成验证

在容器内按 [验证标准](verification.md) 完成静态检查、真实构建、发布安装和必要的功能验证。升级或修订后必须真实构建。需要跨平台验证时，同时保留或更新 port 的 `test.js`。

容器验证不能替代所有真机场景。如果改动可能影响其他平台，还应确认没有破坏包在 darwin、linux-glibc、win32 等平台上的正常使用。

## 5. 整理 commit

**每个 PR 必须且只能包含一个 commit。** 这个限制适用于所有改动，包括文档、CI 和其他非 port 变更。提交前先整理历史，不要把开发过程中的多个临时 commit 直接带入 PR。

改动 `ports/**` 时，唯一的 commit 还要符合以下 message 规范：

- 新增 port：`<port>: add port <version>`
- 版本升级：`<port>: bump to <version> ...`
- 仅增加修订号：`<port>: bump port revision to <version>`
- 修复或整理：`<port>: <具体做了什么>`

非 `ports/**` 改动不套用上述 message 格式，但仍须遵守“一个 PR 一个 commit”。PR 的 `lint-commits` 会检查适用范围内的 commit message，并在失败时给出具体原因。

## 6. 创建并更新 PR

将分支推送到个人仓库，然后向社区仓库的 `main` 分支创建 PR。PR 的构建、临时 Verdaccio 和跨平台验证由社区仓库的流水线执行。个人仓库没有中心仓 `NPM_TOKEN`，不会进入正式发布步骤。完整门禁说明见 [流水线](../maintainer/pipeline.md)。

创建 PR 后如需继续修改，使用 `git commit --amend` 或将多个提交 squash 为一个，再对自己的源分支执行 `git push --force-with-lease`。不要通过追加新 commit 保留开发历史。`PR commit count` 会在创建 PR 和源分支后续推送时重新检查，超过一个 commit 就会失败。

## 7. 合并后的发布

PR 合并后，流水线自动构建。所有平台验证通过后，由发布工作流发布已经验证的 tarball。贡献者无需也不应手动执行 `npm publish`。
