# npm-ports 命令行工具

`npm-ports` 用于创建、编辑、构建、检查、打包和滚动更新 NPMBUILD port。工具使用 Node.js 和 Bash，无第三方 npm 运行时依赖；要求 Node.js 20 或更高版本。真实 port 构建应在 ci-runner 容器中执行。

## 安装与 port 参数

在仓库根目录执行：

```sh
export PATH="$PWD/cli:$PATH"
```

之后直接使用 `npm-ports <command>`，不需要输入 `node cli/npm-ports`。`<port>` 可以是发布短名、带版本线的短名或完整 port 目录，例如：

```sh
npm-ports info parcel-watcher
npm-ports info lightningcss@1.32
npm-ports info ports/p/parcel-watcher
```

## 创建和编辑配方

```sh
npm-ports create <upstream> [--set-name <port>] [--set-version <version>] [--no-fetch]
npm-ports edit <port>
```

`create` 接受 npm 上游包名，例如 `is-number` 或 `@parcel/watcher`：

- 默认查询 registry，取得最新版本和 tarball，并下载计算 SHA-256。
- `--set-name` 覆盖默认发布短名；scoped 上游默认按 `scope/name` → `scope-name` 扁平化。
- `--set-version` 指定上游版本，而不是默认的最新版本。
- `--no-fetch` 不访问 registry，未确定的版本和 SHA-256 留待手工填写。
- 生成 `ports/<首字母>/<port>/NPMBUILD`，已有 port 不会被覆盖。
- 骨架包含下载校验、解包和基础发布短名改写；移植补丁和实际构建逻辑需要继续完善。

`create` 和 `edit` 都会打开 NPMBUILD。编辑器依次取 `VISUAL`、`EDITOR`，未设置时使用 vim。`edit` 一次只接受一个 port，可直接使用版本线短名，不需要手工查找路径。

## 查询与静态检查

```sh
npm-ports list
npm-ports info <port|--all> [--json]
npm-ports lint [port|--all]
```

`list` 列出全部 port；`info` 查看上游、版本、dist-tag 和产物；`lint` 检查元数据、Bash 语法、目录、版本线、命名冲突、旧元数据别名、readelf、签名和连续空行等现行规则。lint 不能替代真实构建。

## 构建、检查与打包

```sh
npm-ports prepare <port>
npm-ports build <port>
npm-ports package <port>
npm-ports check <port>
npm-ports pack <port> [--no-build]
```

生命周期为 `prepare() → build() → package() → check()`，由管理器自动调用，不需要在钩子内手动串联：

- `prepare`：安装工具、下载、校验并解包。
- `build`：自动执行 prepare 和 build。
- `package`：再执行 package，主包与槽位保持裸上游版本。
- `check`：再执行 check，验证实际发布目录。
- `pack`：执行完整生命周期，注入 revision 并同步同 port 槽位引用，使用 `/storage/Users/currentUser/.harmonybrew/opt/ohos-selfsign/bin/selfsign --force` 统一为发布目录中的 AArch64 ELF 签名，然后生成 npm tarball；`--no-build` 只复用已经通过检查的发布目录。

同一主包或槽位的钩子在同一 Bash 进程内执行，主包和槽位之间隔离。槽位在同一 NPMBUILD 中声明，不另建独立 port。

## 上游升级与修订

```sh
npm-ports bump <port|--all> [--write] [--registry URL]
npm-ports bump-pr <port> [--no-draft] [--base main]
npm-ports revision <port> [--set N]
```

- `bump` 根据上游 npm registry 的 dist-tags 和版本列表检查更新；`--write` 精确修改 `version`、主 `source`/`sha256` 及所有引用 `${version}` 的 `resource` 声明，重新计算下载摘要并将 revision 重置为 1。固定版本的资源保持不变，注释、构建参数和补丁不做全局替换。
- `bump-pr` 一次只处理一个 port，完成更新、按目标版本命名分支、提交、普通推送和 PR 创建；默认草稿，`--no-draft` 用于已配置的 GitHub App。只要已有开放 PR 修改同一 port，无论是同版本还是旧版本、机器人还是人工提交，都会跳过，绝不强推或覆盖原 PR。
- `revision` 在上游版本不变时递增移植修订号，最终版本为 `<上游版本>-<revision>`。
- revision 是发布版本号，不是触发重新编译的开关。只有需要发布新产物时才递增；纯格式调整不需要递增。需要重新发布同一上游版本的新产物时必须递增，npm 不允许覆盖已发布版本。

升级或修订后必须执行真实构建，不能只修改元数据。

## 发布与私仓验证

```sh
npm-ports publish <port> [--dry-run] [--registry URL]
sh .github/scripts/validate-local-publish.sh ports/<首字母>/<port>
```

`publish` 只发布通过检查的 tarball。日常验证使用 `--dry-run` 或临时 Verdaccio；正式发布应由发布工作流完成，不要在 NPMBUILD 内执行 `npm publish`。

推荐的本地检查顺序：

```sh
npm-ports lint <port>
npm-ports check <port>
sh .github/scripts/validate-local-publish.sh ports/<首字母>/<port>
```

命令总览可随时通过 `npm-ports --help` 查看。NPMBUILD 字段和生命周期规范见 [port-spec.md](port-spec.md)，验证标准见 [verification.md](verification.md)。
