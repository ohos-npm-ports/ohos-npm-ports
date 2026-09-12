# 使用方法

已收录的包清单见仓库根目录 [README.md](../../../README.md)。

## 直接依赖：用 npm alias 替换包名

如果你的项目直接依赖了某个已收录的包（以 `sqlite3` 为例）：

```json
{
  "dependencies": {
    "sqlite3": "npm:@ohos-npm-ports/sqlite3"
  }
}
```

## 间接依赖：用 overrides 覆盖

如果依赖是通过别的包间接引入的：

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

需要锁定具体版本时可以写成 `npm:@ohos-npm-ports/sqlite3@5.1.7-7` 这种形式。

## 平台专属子包不用手动装

`@ohos-npm-ports/parcel-watcher-openharmony-arm64`、`@ohos-npm-ports/tailwindcss-oxide-openharmony-arm64` 这类包名带 `-openharmony-arm64` 后缀的，是给对应主包通过 `optionalDependencies` 自动引用的平台二进制槽位，不需要在自己的项目里直接依赖它们——装了主包（如 `@ohos-npm-ports/parcel-watcher`）就会自动装好。

## 兼容性

本仓库主要针对社区版 OpenHarmony 构建，但一般情况下构建出来的包也能运行在 OpenHarmony 的商用发行版——HarmonyOS 上。如果遇到某个包在 HarmonyOS 上表现和 OpenHarmony 社区版不一致，欢迎提 issue 说明具体差异。
