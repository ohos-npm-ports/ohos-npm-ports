# 贡献指南

本仓库把 npm 三方包移植到 OpenHarmony（以下简称鸿蒙）平台。贡献分两类：

- 录入一个新包 → 先看下面「准入」，再照 [port-spec.md](port-spec.md) 建目录
- 一个包在鸿蒙上跑不起来，想知道该走哪条路 → 看 [porting-guide.md](porting-guide.md)

改动提交前的自检清单在 [verification.md](verification.md)；PR 打开后 CI 会跑什么、门禁怎么判定见 [../maintainer/ci-pipeline.md](../maintainer/ci-pipeline.md)。

## 准入规则

- 优先级永远是「上游原生支持 > 官方社区 fork/port > 本仓库临时收录」。往这里加一个包之前，先确认它没有已经在计划或进行中的上游 PR——本仓库的定位是**临时垫层**，不是长期分发点（见「项目治理」）。
- 移植后的包不能破坏它在其他平台上的行为：一个只能在鸿蒙上用的包无法支撑真实生产场景（用户的工程可能因此在 Linux 流水线上构建失败）。
- 发布用的包名一律 `@ohos-npm-ports/<name>`；发布版本号一律 `<上游版本>-<修订号>`（如 `5.1.7-8`），修订号从 `-1` 起，允许在不改上游版本号的前提下多次迭代补丁。
- 注意开源合规：移植时不得改动原作者与开源许可证信息。

## 开发环境：必须在容器里做

为了让本地环境和流水线环境保持一致（「在我的机器上能跑通」等价于「在流水线上能跑通」），所有构建/调试工作必须在容器内完成，不要在宿主机上直接跑 `build.sh`。

```sh
docker pull ghcr.io/ohos-npm-ports/ci-runner:latest
docker run -itd --name=ohos ghcr.io/ohos-npm-ports/ci-runner:latest
docker exec -it ohos sh
git clone https://github.com/ohos-npm-ports/ohos-npm-ports.git
cd ohos-npm-ports/ports/<name>/<version>
./build.sh
```

- 若 GHCR 访问不通，把 `ghcr.io` 换成 `ghcr.nju.edu.cn`（南京大学镜像站）。
- 镜像会持续更新，建议每次工作前 `docker pull` 一次；镜像未变化时不会重复下载。
- 镜像源码在本仓库的 [`docker/Dockerfile`](../../../docker/Dockerfile)，基于 `ghcr.io/hqzing/dockerharmony` 加装 Harmonybrew（`brew`）与开发工具。
- 硬件必须是 arm64 原生（arm 服务器、Mac、鸿蒙 PC 等）——x86_64 上用指令集翻译跑 arm64 容器性能极差，满足不了编译构建需求。
- 网络需要能访问 GitHub（源码/发行版通常挂在那里），建议选香港或海外地域的服务器。

**`ci-runner` 和 `dockerharmony` 不是一回事**：`ci-runner`（`ghcr.io/ohos-npm-ports/ci-runner`）是本仓库 CI 实际使用的镜像，`brew install`、`git` 等工具齐全，**带 bash**；上游 CI 早期用过的裸 `dockerharmony` 镜像不带 bash——凡是要在容器里跑的脚本（`build.sh`、`publish.sh`，以及本仓库自己的门禁脚本）一律只能用 POSIX `sh` 语法，写成 `#!/bin/bash` 或用到 `[[ ]]`/数组的脚本进容器会直接 `exec: "bash": executable file not found`（exit 127）。宿主机（GitHub Actions runner 本身，不进容器的 job）不受此限制，可以正常用 bash。

## Fork 与 PR 流程

1. Fork 本仓库到自己的账号，在个人仓的 Actions 里启用工作流。
2. 参照最近同类包的 `build.sh`/`publish.sh`/`patchs/` 写移植补丁（见 [port-spec.md](port-spec.md)）。
3. 在容器内本地构建、验证通过（见 [verification.md](verification.md)）。
4. 推到个人仓，确认 `ci.yml` 在自己仓里能跑通 `build.sh`（`publish.sh` 会因权限报错——这是预期行为，个人仓没有发包用的 `NPM_TOKEN`）。
5. 提 PR 到本仓库。合并后流水线自动构建发包，不需要人工介入发布。

## Commit 规范

只对改动了 `ports/**` 的 commit 生效（改 README、CI 配置等不受限）：

- 新增 port：`<port>: add port <version>`
- 版本升级：`<port>: bump to <version> ...` 或（仅改修订号）`<port>: bump port revision to <version>`
- 修复/整理：`<port>: <具体做了什么>`

这是从仓库自身历史里归纳出来的既有约定（早期提交更自由，这条规范只管将来），PR 里的 commit message 会被 CI 自动检查，格式不对会在 PR 里看到具体哪一条不通过。
