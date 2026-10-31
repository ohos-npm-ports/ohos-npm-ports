# NPMBUILD 规范：port、版本、patch 与发布

## 1. 目录与命名

在本项目中，每一个 npm 包对应一个 port，拥有自己的独立目录。例如：`ports/p/parcel-watcher`。

目录结构如下：
```text
ports/<首字母>/<port>/
├── NPMBUILD                  # 必须：元数据、产物和完整生命周期实现
├── patches/                   # 可选
├── test.js                   # consumer 测试
└── slots/<slot>/             # 可选：同版本、同 revision 的槽位辅助文件
```

port 目录使用**发布短名**，最终主包为 `@ohos-npm-ports/<pkgname>`。上游 scoped 包默认扁平化，例如 `@ast-grep/napi` 对应 `ports/a/ast-grep-napi`。`upstream` 字段精确保留 `@ast-grep/napi`，不依赖目录反推。不同上游映射到同一发布短名会被 lint 阻断，需人工选择无歧义名称。

port 的维护模式为滚动更新，每个 port 目录只保留最新版本的数据。如果需要锁版本，则需要为包名加一个 `@<版本线>` 后缀，作为一个新的 port 录入。例如：`ports/l/lightningcss@1.32`。

版本线后缀通常使用 `@major`、`@major.minor` 或完整版本后缀，0.x 通常至少保留 minor。`@` 后缀不属于 npm 包名，且必须使用非 `latest` 的 dist-tag。新增旧版本线需先确认维护必要性。

## 2. NPMBUILD

NPMBUILD 是本项目的软件包配方，文件格式如下：

```bash
#!/usr/bin/env bash
pkgname="example"
upstream="@upstream/example"
version="1.2.3"
revision=1
dist_tag="latest"
packages=("build/example-${version}")

prepare() {
  # 安装工具、下载、校验并解包。
}
build() {
  # 编译；可以在这里应用源码补丁。
}
package() {
  # 生成 packages 声明的发布目录。
}
check() {
  # 验证包内容、安装和真实加载。
}
```

必填字段为 `pkgname`、`upstream`、`version`、`revision`、`dist_tag`、`packages` 和 `build()`。`packages` 按发布顺序列出全部产物。`prepare()`、`package()` 和 `check()` 按需实现，缺省时自动跳过。

版本、源码 URL、SHA-256 和共享路径等纯声明集中在生命周期函数之前，且同一变量只定义一次。当前 port 的上游版本统一引用 `${version}`，发布短名统一引用 `${pkgname}`，不要在不同钩子中重复抄写版本或包名。`prepare()` 与 `package()` 不重复声明同一份源码参数。跨 port 依赖的版本单独锁定，不能误用当前 port 的 revision。

配方自己的局部变量使用 `lower_snake_case`，例如 `build_dir`、`source_dir`、`archive_dir` 和 `slot_name`。只有管理器提供的 `NPMBUILD_*`、外部工具或子进程明确要求的环境变量使用大写，例如 `PATH`、`CARGO_HOME`、`CC`；不要为了风格统一而改写这些环境变量。

本项目配套提供了一个 [命令行工具](cli.md)。这个命令行工具也被称为“管理器”，它对外暴露的命令名为 `npm-ports`。在仓库根目录执行 `export PATH="$PWD/cli:$PATH"` 后，即可使用这个命令。

管理器执行命令时会自动调用这些 NPMBUILD 钩子函数：

- `prepare`：执行 prepare()。
- `build`：自动执行 prepare()、build()。
- `package`：再执行 package()，产物保持裸上游版本。
- `check`：再执行 check()，验证实际发布目录。
- `pack`：执行完整生命周期，注入 revision 并同步槽位引用，统一签名后生成 npm tarball；`--no-build` 只复用已有发布目录。
- `publish`：只发布已通过验证的 tarball，不重新执行生命周期。

`check()` 放在 `package()` 后，是为了直接验证最终包布局。此时 package.json 仍是裸上游版本，最终 `<上游版本>-<revision>` 只在 `pack` 阶段写入。同一主包或槽位在一个 Bash 进程内顺序执行所有生命周期钩子，变量、环境和当前目录可以按此顺序传递；主包与槽位使用不同进程，彼此隔离。`packages` 的顺序只决定 staging 和发布顺序。

签名同样只属于 `pack`：管理器统一为发布目录中的 AArch64 ELF 调用 `selfsign --force <文件>`（该签名工具已通过 Harmonybrew 安装，集成在 ci-runner 镜像中），签名失败会中断打包。贡献者不需要也不应在 NPMBUILD 中处理任何签名相关事项，也不需要在钩子中调用 `readelf`。但 loader 和真实功能验证仍由配方负责。

在 NPMBUILD 中，`source` 和 `sha256` 必须成对声明。与 Homebrew 一样，附加下载的声明关键字使用单数 `resource`，每个资源有独立名称、URL 和 SHA-256：

```bash
source="https://registry.npmjs.org/example/-/example-${version}.tgz"
sha256="64 位小写十六进制摘要"
resource "source_archive" \
  "https://github.com/example/example/archive/v${version}.tar.gz" \
  "64 位小写十六进制摘要"
resource "pinned_tool" \
  "https://example.com/tool-1.0.0.tar.gz" \
  "64 位小写十六进制摘要"

prepare() {
  fetch_source build/example.tgz
  fetch_resource "source_archive" build/source.tar.gz
  fetch_resource "pinned_tool" build/tool.tar.gz
}
```

下载源码和资源时需要使用辅助函数 `fetch_source` 和 `fetch_resource` ，辅助函数会自动进行 SHA-256 校验。禁止在钩子中另写 `curl` 下载及 SHA-256 校验逻辑。资源名使用 `lower_snake_case`；可通过 `${resource_<name>_url}` 和 `${resource_<name>_sha256}` 引用元数据。主包与槽位在各自工作目录中获取同一资源时仍分别校验。

管理器在执行 bump 时会根据 `upstream` 查询 npm registry 的 dist-tags 和版本列表。主 `source` 及 URL 中含 `${version}` 的 `resource` 会随主版本重新展开并下载计算摘要；含 `${vips_version}` 等独立版本变量、固定工具链版本或 commit 的资源保持锁定，由维护者配套升级。预览线可设置 `upstream_tag`；当 npm 预览版本与源码 tag/commit 没有可靠映射时，必须设置 `bump=false` 并说明耦合原因，不能生成错配 PR。

写入时只精确修改 `version`、`revision`、`source`/`sha256` 和命中的 `resource` 声明，不做全文版本号替换，也不改注释、普通构建参数或补丁。NPMBUILD 使用 Bash，由管理器 source。下载、补丁、编译和构建期测试保持原有质量要求；新增或升级来源必须提供校验值。

npm 包的打包和发布由管理器自动处理，NPMBUILD 中禁止执行 `npm publish` 操作。

## 3. 版本与 revision

- `version` 只写上游版本，`revision` 从 1 开始，最终包版本是 `<version>-<revision>`。revision 是发布版本号，不是重新编译的开关；纯格式调整不需要递增，需要重新发布同一上游版本的新产物时必须递增。
- 全局 `revision` 是当前 port 修订版本号的唯一来源。这个变量仅供管理器使用，构建脚本不感知修订版本号的存在。禁止在 NPMBUILD 中的任何位置对这个变量进行复制和使用。
- 当前 port 的主包、槽位、构建期断言和补丁只使用裸 `${version}`；补丁不得修改自身 package.json 的版本字段。跨 port 依赖是独立锁定的外部坐标，仍需保留对方完整的已发布版本（包括对方的 revision）。
- 移植修复：`npm-ports revision <port>`，只递增全局 revision。
- 上游升级：`npm-ports bump <port> --write`，精确修改 NPMBUILD 的版本及关联 source/resource 摘要并将 revision 重置为 1，不扫描或改写补丁；升级后按需重新生成补丁。
- 创建一个升级 PR：`npm-ports bump-pr <port>`，一次只接受一个 port；同 port 已有开放 PR 时跳过，不覆盖旧 PR。默认草稿，配置 GitHub App 后可用 `--no-draft`。
- 只有 `npm-ports pack` 在生成 tarball 前统一注入最终版本、同步同 port 槽位引用并为 AArch64 ELF 签名。

所有产物必须位于 `@ohos-npm-ports/` scope，主包名必须是 `@ohos-npm-ports/<pkgname>`。repository.directory 由打包器设置为当前 port 目录。

## 4. 槽位包

平台槽位不再单独建立 port。主 port 在 `slots/<slot>/` 保存补丁等辅助文件，在同一个 NPMBUILD 中实现 `slot_<slot>_<phase>()` 钩子，并在 `packages` 中先列槽位、再列主包。槽位名中的非字母数字替换为下划线，例如：

```bash
packages=(
  "slots/openharmony-arm64/example-openharmony-arm64-1.2.3"
  "example-1.2.3"
)
slot_openharmony_arm64_build() {
  # 使用 NPMBUILD_SLOT_DIR，构建槽位。
}
```

主包和槽位共享 version/revision，统一构建、打包、artifact、私仓验证和发布。`NPMBUILD_DIR` 始终是主 port 目录，`NPMBUILD_SLOT_DIR` 是当前主包或槽位的工作目录。

## 5. patch 与 lint

- patch 使用 `NNNN-描述.patch`，并由 NPMBUILD 的钩子实际应用。
- 修改 patch 应重新生成 diff，应用后验证关键标记。
- `npm-ports lint --all` 检查元数据、首字母目录、发布短名冲突、Bash 语法、孤立 patch、遗留 publish.sh、旧元数据别名、版本字面量、重复全局声明、重复 SHA-256、readelf、签名逻辑、连续空行和构建内直接发布。
- lint 不能证明上游 patch 仍兼容，升级后必须真实构建。

## 6. 私仓验证

```sh
npm-ports check ports/p/<port>
sh .github/scripts/validate-local-publish.sh ports/p/<port>
```

该脚本打包全部产物、发布到临时 Verdaccio、校验 tarball 和 integrity，并实际安装。需要跨平台验证时，同时保留或更新 port 的 test.js。
