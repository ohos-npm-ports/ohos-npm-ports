# ohos-npm-ports

## 项目介绍

ohos-npm-ports 是一个将 npm 三方库移植到 OpenHarmony 平台的项目。

Node.js 已支持 OpenHarmony，但并非所有 npm 包都能直接运行，尤其是包含原生 addon 的包。这类包通常需要额外的编译、补丁或平台二进制适配。本项目为它们提供可安装的移植版本。

ports 既表示“移植软件”，也表示以 ports 模式维护：只保存构建脚本和补丁，不保存完整源码。

## 已收录的包

已发布的移植包、版本和接入配置请查看[项目主页](https://ohos-npm-ports.github.io/)，构建脚本和补丁见 [ports/](ports/)。

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

> 提示：如果需要指定版本号，可以写成这种形式：npm:@ohos-npm-ports/sqlite3@5.1.7-7

## 兼容性

本项目主要针对 OpenHarmony 构建 npm 包，未对所有商用系统版本逐包验证。请在目标设备上验证具体包的加载和运行。

## 贡献指南

请参阅[贡献指南](docs/zh-CN/contributor/contributing.md)。

## 项目治理

注意事项：

- 本仓库中的包主要供临时使用，当一个包正式被官方接纳后，维护者会将这个包从本仓库中删去，不再接受贡献。

若有问题咨询求助，可联系以下维护者：

- [hqzing](https://github.com/hqzing)：hqzing@outlook.com

## 许可证

本项目自身编写的代码及自研补丁采用 BSD Zero Clause License。

本项目所修改并分发的第三方 npm 包，其版权仍归属于各自的原始作者，并遵循其各自原有的许可证。
