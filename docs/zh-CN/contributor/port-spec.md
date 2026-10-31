# NPMBUILD 配方规范

本文定义 port 目录、NPMBUILD 字段、生命周期和产物必须遵守的规则。命令的完整用法见 [npm-ports 命令行工具](cli.md)，验证要求见 [验证标准](verification.md)。

## 1. port 目录与命名

每一个 npm 包对应一个 port，拥有独立目录，例如 `ports/p/parcel-watcher`：

```text
ports/<首字母>/<port>/
├── NPMBUILD                  # 必须：元数据、产物和完整生命周期实现
├── patches/                  # 可选
├── test.js                   # 可选：consumer 功能测试
└── slots/<slot>/             # 可选：同版本、同 revision 的槽位辅助文件
```

port 目录使用**发布短名**，最终主包为 `@ohos-npm-ports/<pkgname>`。上游 scoped 包默认扁平化，例如 `@ast-grep/napi` 对应 `ports/a/ast-grep-napi`。`upstream` 字段精确保留 `@ast-grep/napi`，不依赖目录反推。不同上游映射到同一发布短名会被 lint 阻断，需人工选择无歧义名称。

port 采用滚动更新，每个目录只保留最新版本的数据。需要锁定版本时，为包名增加 `@<版本线>` 后缀并作为新 port 录入，例如 `ports/l/lightningcss@1.32`。

版本线后缀通常使用 `@major`、`@major.minor` 或完整版本后缀，0.x 通常至少保留 minor。`@` 后缀不属于 npm 包名，且必须使用非 `latest` 的 dist-tag。新增旧版本线需先确认维护必要性。

## 2. 元数据与声明

NPMBUILD 是使用 Bash 编写的软件包配方，由 `npm-ports` 加载。基本结构如下：

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
  # 编译，也可以在这里应用源码补丁。
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

配方自己的局部变量使用 `lower_snake_case`，例如 `build_dir`、`source_dir`、`archive_dir` 和 `slot_name`。只有 `npm-ports` 提供的 `NPMBUILD_*`、外部工具或子进程明确要求的环境变量使用大写，例如 `PATH`、`CARGO_HOME`、`CC`。不要为了风格统一而改写这些环境变量。

## 3. 源码与资源

`source` 和 `sha256` 必须成对声明。附加下载的声明关键字使用单数 `resource`，每个资源有独立名称、URL 和 SHA-256：

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

下载源码和资源时必须使用 `fetch_source` 和 `fetch_resource`，辅助函数会自动进行 SHA-256 校验。禁止在钩子中另写 `curl` 下载及 SHA-256 校验逻辑。资源名使用 `lower_snake_case`。可通过 `${resource_<name>_url}` 和 `${resource_<name>_sha256}` 引用元数据。主包与槽位在各自工作目录中获取同一资源时仍分别校验。新增或升级来源必须提供校验值。

预览线可设置 `upstream_tag`。当 npm 预览版本与源码 tag 或 commit 没有可靠映射时，必须设置 `bump=false` 并说明耦合原因，避免自动升级生成错配 PR。独立版本变量、固定工具链版本或 commit 锁定的资源由维护者配套升级，不能随主版本误更新。

## 4. 生命周期与执行规则

生命周期顺序为 `prepare() → build() → package() → check()`：

- `prepare()`：安装工具、下载、校验并解包。
- `build()`：编译，可以在这里应用源码补丁。
- `package()`：生成 `packages` 声明的发布目录，产物保持裸上游版本。
- `check()`：验证 `package()` 生成的实际发布目录。

`npm-ports` 会自动执行到命令对应的阶段，不要在钩子内手动串联后续阶段。`check()` 位于 `package()` 之后，用于直接验证最终包布局。此时 package.json 仍是裸上游版本，最终 `<上游版本>-<revision>` 只在 `pack` 阶段写入。

同一主包或槽位在一个 Bash 进程内顺序执行所有生命周期钩子，变量、环境和当前目录可以按此顺序传递。主包与槽位使用不同进程，彼此隔离。`packages` 的顺序只决定 staging 和发布顺序。

只有 `pack` 阶段会统一注入 revision、同步同 port 槽位引用，并为发布目录中的 AArch64 ELF 调用签名工具。签名失败会中断打包。贡献者不需要也不应在 NPMBUILD 中处理签名，也不需要调用 `readelf`。loader 和真实功能验证仍由配方负责。

NPMBUILD 中禁止执行 `npm publish`。npm tarball 的生成和发布由 `npm-ports` 处理。

## 5. version 与 revision

- `version` 只写上游版本，`revision` 从 1 开始，最终包版本是 `<version>-<revision>`。
- revision 是发布版本号，不是重新编译的开关。纯格式调整不需要递增。需要重新发布同一上游版本的新产物时必须递增。
- 全局 `revision` 是当前 port 修订版本号的唯一来源，仅供 `npm-ports` 使用。禁止在 NPMBUILD 的任何位置复制或使用这个变量，构建脚本不感知修订号。
- 当前 port 的主包、槽位、构建期断言和补丁只使用裸 `${version}`。补丁不得修改自身 package.json 的版本字段。
- 跨 port 依赖是独立锁定的外部坐标，必须保留对方完整的已发布版本，包括对方的 revision。
- 上游升级后将 revision 重置为 1。只修复移植问题时递增 revision。对应命令见 [npm-ports 命令行工具](cli.md#上游升级与修订)。

所有产物必须位于 `@ohos-npm-ports/` scope，主包名必须是 `@ohos-npm-ports/<pkgname>`。`repository.directory` 由打包器设置为当前 port 目录。

## 6. 槽位包

平台槽位不单独建立 port。主 port 在 `slots/<slot>/` 保存补丁等辅助文件，在同一个 NPMBUILD 中实现 `slot_<slot>_<phase>()` 钩子，并在 `packages` 中先列槽位、再列主包。槽位名中的非字母数字替换为下划线，例如：

```bash
packages=(
  "slots/openharmony-arm64/example-openharmony-arm64-1.2.3"
  "example-1.2.3"
)
slot_openharmony_arm64_build() {
  # 使用 NPMBUILD_SLOT_DIR，构建槽位。
}
```

主包和槽位共享 version 和 revision，统一构建、打包、artifact、私仓验证和发布。`NPMBUILD_DIR` 始终是主 port 目录，`NPMBUILD_SLOT_DIR` 是当前主包或槽位的工作目录。

## 7. patch 与静态约束

- patch 使用 `NNNN-描述.patch`，并由 NPMBUILD 的钩子实际应用。
- 修改 patch 应重新生成 diff，并在应用后验证关键标记。
- 配方必须通过 `npm-ports lint` 的静态检查。具体检查范围见 [npm-ports 命令行工具](cli.md#查询与静态检查)。
- lint 不能证明上游 patch 仍兼容。新增、升级或修订后必须按 [验证标准](verification.md) 完成真实构建和验证。
