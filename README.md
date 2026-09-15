# ohos-npm-ports

## 项目介绍

ohos-npm-ports 项目，是一个把 npm 三方库移植到 OpenHarmony 平台的项目。

ports 这个词一语双关，既表示移植软件，也表示本项目采用 ports 模式维护软件包（只存储构建脚本，不存储完整源码） 。

## 本项目解决什么问题

当前 Node.js 运行时已经支持 OpenHarmony 平台（以下简称鸿蒙），详见[官方文档](https://github.com/nodejs/node/blob/main/BUILDING.md)。

然而，Node.js 运行时支持鸿蒙，并不意味着 npm 包也一定支持鸿蒙。因为有一部分 npm 包并不是跨平台的，尤其是使用了 addon 技术的 npm 包最为典型。这些 npm 包想要在鸿蒙上正常使用，是需要做移植/适配工作的。

对于需要鸿蒙适配的 npm 包，最佳的处理方式是直接往官方社区提 PR，让官方社区支持鸿蒙，不要额外 fork 版本出来维护。这样可以既让维护成本最小化，也能让用户得到最佳的使用体验。

这个项目主要是用于处理那些短时间无法合入官方社区、但在业界又有广泛使用诉求的包。

项目维护者在 npm 中心仓上面注册了一个 scope 叫做 `@ohos-npm-ports`，其他开发者可以把一些已经做了鸿蒙适配、但又没能合入到官方社区的 npm 包发布到这个 scope 下面，用户可以通过新的包名在鸿蒙设备上下载、使用这些包。

## 已收录的包

| 原始包名   | 鸿蒙适配后的包名           | 最新版本  |
| ---------- | -------------------------- | --------- |
| bufferutil | @ohos-npm-ports/bufferutil | 4.0.9-7   |
| sqlite3    | @ohos-npm-ports/sqlite3    | 5.1.7-8   |
| typescript | @ohos-npm-ports/typescript | 7.0.2-2   |
| nx         | @ohos-npm-ports/nx         | 23.1.1-1  |
| turbo      | @ohos-npm-ports/turbo      | 2.10.10-1 |
| opentui-core | @ohos-npm-ports/opentui-core | 0.5.8-1 |
| playwright-mcp | @ohos-npm-ports/playwright-mcp | 0.0.78-1 |

## 使用方法

以 `sqlite3` 这个包为例，如果你的项目直接依赖了它，请使用别名的方式将其替换成 `@ohos-npm-ports/sqlite3`

```json
{
  "dependencies": {
    "sqlite3": "npm:@ohos-npm-ports/sqlite3"
  }
}
```

如果你的项目间接依赖了它，请使用 overrides 字段去进行依赖覆盖，将其替换成 `@ohos-npm-ports/sqlite3`

```json5
{
  "dependencies": {
    "sqlite-tool": "^0.1.0" // sqlite-tool 依赖 sqlite3，因此这个项目会间接依赖 sqlite3
  },
  "overrides": {
    "sqlite3": "npm:@ohos-npm-ports/sqlite3"
  }
}
```

PS：如果需要指定版本号，可以写成这种形式：npm:@ohos-npm-ports/sqlite3@5.1.7-7

## 兼容性

本项目主要针对 OpenHarmony 构建 npm 包，未对所有商用系统版本逐包验证。请在目标设备上验证具体包的加载和运行。

## 贡献指南

新增 port、升级已有 port 或修复构建问题，请先阅读 [贡献文档](docs/zh-CN/contributor/)。

提交前重点确认构建脚本、补丁、发布包名和版本号符合规范，并完成构建与加载验证。

## 项目治理

注意事项：

- 本仓库中的包主要供临时使用，当一个包正式被官方接纳后，维护者会将这个包从本仓库中删去，不再接受贡献。

若有问题咨询求助，可联系以下维护者：

- [hqzing](https://github.com/hqzing)：hqzing@outlook.com
