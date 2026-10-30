# 原生 npm 包的 port 制作方式

原生 npm 包同时涉及原生代码构建、二进制分发和运行时加载。本文说明常见产物类型、分发方式及构建工具；目录和版本规则见 [port-spec.md](port-spec.md)。

## 1. 最终产物

- 纯 JavaScript 包不需要原生编译，重点是确认运行时没有写死平台名称。
- Node addon（`.node`）必须能被 loader 找到并真实 require()，不能只验证 ELF 存在。
- 独立可执行文件不经过 require()，重点是架构、运行路径、权限和签名。

## 2. 二进制分发方式

### 2.1 主包内嵌

适用于 loader 已支持固定路径，或可以通过补丁让 OpenHarmony 走固定路径的包。构建阶段编译并复制到最终发布目录，再用真实 require() 验证；签名由 `npm-ports pack` 统一完成。

示例：`ports/p/parcel-watcher`。它将 OpenHarmony binding 放入上游 loader 的 fallback 路径，其他平台仍使用上游平台子包；独立槽位也在同一 NPMBUILD 中构建。

### 2.2 `prebuilds` + `node-gyp-build`

适用于 loader 按 `prebuilds/<platform>-<arch>/` 查找文件的包，文件名和目录必须以 loader 实际规则为准。

上游使用 `prebuild` + `prebuild-install` 时，通常需要安装阶段访问 GitHub release。应改成 `prebuildify` + `node-gyp-build`：构建阶段编译 OpenHarmony 产物，必要时取得并校验其他平台产物，全部随包发布，避免安装时远程下载或现场编译。

示例：`ports/s/sqlite3` 和 `ports/b/bufferutil`。

### 2.3 平台二进制子包

适用于上游已经按平台拆包，或主包和二进制必须独立发布的场景。主包通过 optionalDependencies 指向 OpenHarmony 子包，子包只包含对应平台二进制和最小 package.json。

子包名称、版本、main 和文件名必须与主包 loader 一致。它们应在主 NPMBUILD 的 slots/ 中构建，与主包共享 version/revision、artifact 和发布流程，不能单独建槽位 port，也不能只验证子包而不验证干净项目中的主包加载。

### 2.4 安装时远程下载

不建议保留。安装阶段依赖外部 release 会增加网络失败和供应链校验风险。确实无法改造时，应明确依赖、失败回退和支持范围，并说明不能随包分发的原因。

## 3. 构建工具

### 3.1 node-gyp 系

判断依据是存在 binding.gyp 或构建脚本调用 node-gyp。nan、node-addon-api 是 addon API 层，不改变分发方式。

- 上游没有预构建：构建阶段运行 node-gyp rebuild，把 `.node` 放入主包或平台槽位。
- 上游使用 node-pre-gyp：核对平台标识、目录和文件名，避免安装时下载远程文件。
- 上游使用 prebuildify + node-gyp-build：按 loader 规则增加 OpenHarmony 产物。

### 3.2 napi-rs 系

根据当前 `@napi-rs/cli` 对 OpenHarmony 的支持选择命令：

- 支持时使用 `napi build --platform`，检查生成文件名和 loader 路径。
- 不支持时使用 `cargo build --release` 生成 cdylib，再按 loader 规则放置。`.so` 文件名不能直接视为正确结果，必须实际加载。

示例：`ports/l/lightningcss`、`ports/t/tailwindcss-oxide` 使用 napi 构建；`ports/r/resvg-resvg-js`、`ports/a/ast-grep-napi` 直接使用 cargo 构建。

### 3.3 自定义工具链

- Rust CLI 或原生库：确认依赖支持 `aarch64-unknown-linux-ohos`，处理系统调用和 vendored 依赖差异。
- Go 二进制：无 cgo 且依赖允许时可以静态编译；有 cgo 或动态依赖时可能需要处理库路径。
- Zig、Bun 等工具链也必须验证最终包内产物，而不是只检查构建目录中的临时文件。

示例：`ports/t/turbo`、`ports/p/pnpm`、`ports/o/oxlint-tsgolint`、`ports/t/typescript`。

## 4. 发布前检查

1. 源码和上游包来源固定，并有校验值。
2. 补丁确实应用，关键修改在产物中可见。
3. package.json 的 name、version、入口和依赖正确。
4. AArch64 ELF 已由 `npm-ports pack` 统一签名，无需在 NPMBUILD 中处理签名。
5. loader 能命中 OpenHarmony 产物。
6. `npm-ports pack` 和临时 Verdaccio 安装通过，并在干净项目中真实加载。
