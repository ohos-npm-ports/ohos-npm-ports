# 不同构建框架的 port 制作方式

原生 addon/二进制的打包方式跟着上游选的构建框架走，框架不同，"要不要分发多平台产物"、"产物放哪"、"loader 怎么找到它"这些问题的答案完全不一样。参考错框架类型的示例，方向就会偏。先判断上游用的是哪一种，再参考对应类别的示例。

## 1. node-gyp 系

判断依据：`binding.gyp` 存在，`package.json` 里有 `node-gyp`/`node-addon-api`/`nan` 相关依赖。

### 1.1 纯 node-gyp（含 nan）

上游不提供预构建分发，用户安装时在本机现场运行 `node-gyp rebuild`。这类 port 不需要 `prebuilds/` 目录，直接把编译出的 `.node` 放入最终包的固定位置即可。`nan` 只是 addon 使用的 API 封装，不改变这种打包方式。

**示例：仓库内的 `ports/parcel-watcher/2.5.1`**。`datadog-pprof` 虽然用 `node-gyp` 编译，但最终也按 `node-gyp-build` 的预构建目录分发，不属于纯 node-gyp 示例。

### 1.2 node-pre-gyp（历史遗留）

`node-pre-gyp` 使用自己的目录和文件名约定，loader 也可能依赖安装时下载。先确认 loader 的平台标识和产物布局；需要跨平台分发时，在构建阶段取得并整理所需产物，随 npm 包发布，避免安装时访问外部 release。只有在不依赖安装时联网、且目录和 loader 行为已经验证时，才保留原框架。

### 1.3 prebuild + prebuild-install → 改造成 prebuildify + node-gyp-build

上游用 `prebuild` 构建、`prebuild-install` 下载预编译产物，安装时通常还要访问 GitHub release assets。port 应改造成 `prebuildify` + `node-gyp-build`：构建阶段可以下载并整理其他平台产物，最终全部放入发布的 npm 包；用户安装时只从 npm 获取包，不再依赖 GitHub release assets。这样也与本仓库的源码构建和随包分发模式一致。

**示例：仓库内的 `ports/sqlite3/5.1.7`**。改造要点（`patchs/0001-change-prebuild-framework.patch`）：

- `package.json`：`dependencies` 去掉 `bindings`+`prebuild-install`，加 `node-gyp-build`；`devDependencies` 的 `prebuild` 换成 `prebuildify`
- 运行时入口文件（sqlite3 是 `lib/sqlite3-binding.js`）：
  ```diff
  -module.exports = require('bindings')('node_sqlite3.node');
  +module.exports = require('node-gyp-build')(__dirname + "/../")
  ```
- `build.sh` 用 `npm run prebuild`（此时已经是 `prebuildify` 提供的脚本）产出 `prebuilds/<platform>/`，其余平台的官方预编译产物从上游 GitHub Release 下载后一并复制进 `prebuilds/`，让这个包在其他平台上依然可用（准入规则："不能破坏其他平台上的行为"）——原始下载的文件名要按 `node-gyp-build` 的命名约定重命名成 `@ohos-npm-ports+<name>.node`（`node-gyp-build` 用 `+` 而不是 `/` 编码 scope，是文件名限制决定的）。

### 1.4 prebuildify + node-gyp-build（上游本来就是这套框架）

上游已经是 `prebuildify`/`node-gyp-build`，不需要改造框架，直接在已有的 `prebuilds/<platform>-<arch>/` 目录旁边加一个 `openharmony-arm64` 目录即可。

**示例：仓库内的 `ports/bufferutil/4.0.9`**。`npm run prebuild` 编出 OHOS 产物，其余平台产物从已发布的官方 npm tarball 里的 `prebuilds/` 直接复制过来，文件名同样按 `node-gyp-build` 约定重命名（`bufferutil.node` → `@ohos-npm-ports+bufferutil.node`）。

## 2. napi-rs 系

判断依据：上游用 Rust 写的 N-API binding，`Cargo.toml` 依赖 `napi`/`napi-derive`，`package.json` 的 `devDependencies` 有 `@napi-rs/cli`。

### 2.1 `napi build --platform` 能识别 openharmony host

容器里 `rustc` 的 host triple 本身就是 `aarch64-unknown-linux-ohos`，新版本的 `@napi-rs/cli` 能正确识别这是 openharmony 平台，`napi build --platform` 直接可用，产出的文件名、`package.json` 里的 `napi.packageName` 平台后缀都由 napi-rs 自己生成好。

**示例：仓库内的 `ports/lightningcss/1.33.0`、`ports/tailwindcss-oxide/4.3.3`**。

### 2.2 `napi` CLI 版本较老、不认 openharmony host——绕开 `napi build`，直接 `cargo build --release`

上游锁定的 `@napi-rs/cli` 是较老的 2.x 系列，不识别 `openharmony` 这个平台标识，跑 `napi build` 会失败或产出错误的文件名。绕过 CLI，直接 `cargo build --release` 拿到 `.so`（cdylib 产物），再手动按 napi-rs 的命名约定重命名/放置成 loader 期望的路径，效果等价。

**示例：仓库内的 `ports/resvg-resvg-js/2.6.2`（build.sh 头部注释详细说明了这个绕过的理由）、`ports/ast-grep-napi/0.43.0`**。

## 3. 自定义工具链

### 3.1 自定义 Rust 工具链

不是 Node N-API binding，是上游自己用 Rust 写的 CLI 工具或原生库，编译产物是一个独立可执行文件或非 N-API 形态的原生库（走 optionalDependencies 平台包分发，或走 Bun 自己的原生加载机制），不经过 `require()` 直接 dlopen 成 JS 可调用对象那一套。

容器里 `cargo build --release` 直接原生编译（host triple 已经是 `aarch64-unknown-linux-ohos`，不需要配交叉 target）；vendored 依赖（如某些版本的 `nix` crate）没有 OHOS target 支持时，按 [porting-guide.md](porting-guide.md) 的 vendor 补丁手法处理。

**示例：仓库内的 `ports/turbo/2.10.10`**（Rust CLI 主体 + zig 编译的 `libghostty-vt` TUI 部分，产物是独立可执行文件而非 N-API binding）、**`ports/bun-pty/0.4.10`**（专为 Bun 写的原生 pty 库，走 Bun 自己的原生加载机制而非经典 Node N-API，`main` 直接是 TypeScript 源码）。

### 3.2 自定义 Go 工具链

上游用 Go 写了一个原生二进制（编译器、linter 后端等），通过 npm 包分发，Node 侧只是一个薄的 spawn 该二进制的包装层。

Go 静态编译天然适合这个场景：host == target（都是 `aarch64-unknown-linux-ohos`），无 cgo 依赖时直接原生编译即可，产物是单个静态二进制，`-ldflags="-s -w" -trimpath` 减小体积。

**示例：仓库内的 `ports/oxlint-tsgolint/7.0.2001`**（`tsgolint` Go 二进制，源码含 git submodule，`ci-runner` 已装好 git，`git clone`+`git submodule update` 直接用）、**`ports/typescript/7.0.2`**（内嵌 `typescript-go`/`tsgo` 原生编译器的 Go 二进制）。
