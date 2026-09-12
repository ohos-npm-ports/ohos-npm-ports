# ohos-npm-ports

## 项目介绍

ohos-npm-ports 项目，是一个把 npm 三方库移植到 OpenHarmony 平台的项目。

ports 这个词一语双关，既表示移植软件，也表示本项目采用 ports 模式维护软件包（只存储构建脚本，不存储完整源码） 。

## 本项目解决什么问题

当前 Node.js 运行时已经支持 OpenHarmony 平台（以下简称鸿蒙），详见[官方文档](https://github.com/nodejs/node/blob/main/BUILDING.md)。

然而，Node.js 运行时支持鸿蒙，并不意味着 npm 包也一定支持鸿蒙。因为有一部分 npm 包并不是跨平台的，尤其是使用了 addon 技术的 npm 包最为典型。这些 npm 包想要在鸿蒙上正常使用，是需要做移植/适配工作的。

对于需要鸿蒙适配的 npm 包，最佳的处理方式是直接往官方社区提 PR，让官方社区支持鸿蒙，不要额外 fork 版本出来维护。这样可以既让维护成本最小化，也能让用户得到最佳的使用体验。

这个项目主要是用于处理那些短时间无法合入官方社区、但在业界又有广泛使用诉求的包。判断该不该收进这里、该走哪种移植手法，见 [docs/zh-CN/contributor/porting-guide.md](docs/zh-CN/contributor/porting-guide.md)。

项目维护者在 npm 中心仓上面注册了一个 scope 叫做 `@ohos-npm-ports`，其他开发者可以把一些已经做了鸿蒙适配、但又没能合入到官方社区的 npm 包发布到这个 scope 下面，用户可以通过新的包名在鸿蒙设备上下载、使用这些包。

## 已收录的包

| 原始包名   | 鸿蒙适配后的包名           | 最新版本  |
| ---------- | -------------------------- | --------- |
| @ast-grep/napi | @ohos-npm-ports/ast-grep-napi | 0.43.0-1 |
| @datadog/pprof | @ohos-npm-ports/datadog-pprof | 5.17.0-2 |
| @parcel/watcher | @ohos-npm-ports/parcel-watcher | 2.5.1-2 |
| @playwright/mcp | @ohos-npm-ports/playwright-mcp | 0.0.78-1 |
| @prisma/engines | @ohos-npm-ports/prisma-engines | 5.1.1-2 |
| @resvg/resvg-js | @ohos-npm-ports/resvg-resvg-js | 2.6.2-2 |
| @tailwindcss/oxide | @ohos-npm-ports/tailwindcss-oxide | 4.3.3-2 |
| bufferutil | @ohos-npm-ports/bufferutil | 4.0.9-7   |
| bun-pty | @ohos-npm-ports/bun-pty | 0.4.10-1 |
| lightningcss | @ohos-npm-ports/lightningcss | 1.33.0-1 |
| nx         | @ohos-npm-ports/nx         | 23.1.1-1  |
| opentui-core | @ohos-npm-ports/opentui-core | 0.5.8-1 |
| oxlint-tsgolint | @ohos-npm-ports/oxlint-tsgolint | 7.0.2001-1 |
| playwright-core | @ohos-npm-ports/playwright-core | 1.62.1-2 |
| sharp | @ohos-npm-ports/sharp | 0.34.5-1 |
| sqlite3    | @ohos-npm-ports/sqlite3    | 5.1.7-8   |
| turbo      | @ohos-npm-ports/turbo      | 2.10.10-1 |
| typescript | @ohos-npm-ports/typescript | 7.0.2-2   |
| vite-plus | @ohos-npm-ports/vite-plus | 0.2.8-2 |
| yuku-codegen | @ohos-npm-ports/yuku-codegen | 0.5.44-1 |
| yuku-parser | @ohos-npm-ports/yuku-parser | 0.7.0-1 |

注：`@ohos-npm-ports/parcel-watcher-openharmony-arm64`、`@ohos-npm-ports/tailwindcss-oxide-openharmony-arm64` 等平台二进制子包由对应主包通过 optionalDependencies 自动引用，无需直接安装。

## 使用方法

用 npm alias 把依赖替换成对应的 `@ohos-npm-ports/*` 包（直接依赖用 `dependencies`，间接依赖用 `overrides`）：

```json
{
  "dependencies": {
    "sqlite3": "npm:@ohos-npm-ports/sqlite3"
  }
}
```

完整用法（间接依赖、指定版本号）和常见问题见 [docs/zh-CN/user/usage.md](docs/zh-CN/user/usage.md) 和 [docs/zh-CN/user/FAQ.md](docs/zh-CN/user/FAQ.md)。

## 兼容性

本项目主要针对社区版 OpenHarmony 构建 npm 包，但一般情况下构建出来的 npm 包也可运行在 OpenHarmoy 的商用发行版——HarmonyOS 中。

## 贡献指南

想往这里面录入一个新包，或者给已有 port 提修复/升级？看 [docs/zh-CN/contributor/](docs/zh-CN/contributor/)：

- [contributing.md](docs/zh-CN/contributor/contributing.md) — 开发环境（容器化开发是硬要求）、Fork/PR 流程、commit 规范
- [porting-guide.md](docs/zh-CN/contributor/porting-guide.md) — 该不该收进这里、遇到具体问题该走哪种移植手法
- [port-spec.md](docs/zh-CN/contributor/port-spec.md) — port 目录/命名/版本/patch 规范
- [verification.md](docs/zh-CN/contributor/verification.md) — 怎样才算验证到位

## 项目治理

本仓库中的包主要供临时使用，当一个包正式被官方接纳后，维护者会将这个包从本仓库中删去，不再接受贡献。完整的治理规则（包括发布出问题了怎么处理）见 [docs/zh-CN/maintainer/](docs/zh-CN/maintainer/)。

若有问题咨询求助，可联系以下维护者：

- [hqzing](https://github.com/hqzing)：hqzing@outlook.com
