# 不同构建框架的 port 制作方式

原生 addon/二进制的打包方式跟着上游选的构建框架走，框架不同，"要不要分发多平台产物"、"产物放哪"、"loader 怎么找到它"这些问题的答案完全不一样。抄错框架类型的标杆包，方向就偏了。先判断上游用的是哪一种，再照对应类别的标杆包抄。

## node-gyp 系

判断依据：`binding.gyp` 存在，`package.json` 里有 `node-gyp`/`node-addon-api`/`nan` 相关依赖。

### 纯 node-gyp（无预构建分发框架）

上游不做多平台预编译分发，用户装包时在本机现场跑 `node-gyp rebuild`（或 `npm install` 触发的 `install`/`prepare` 脚本间接调用）。仓库里还没遇到这种上游确实完全没有任何预构建机制、且也不需要我们额外处理分发的场景——大多数会用到原生 addon 的 npm 包，上游多少都会带一点预构建产物分发（哪怕只是 `prebuild-install`）。真遇到时按下面"纯 node-gyp/nan，产物直接内嵌本包"这一类处理即可：反正 OHOS 平台就是现场编译，跟"上游本来就没有预构建框架"完全兼容。

### node-pre-gyp（历史遗留）

`mapbox/node-pre-gyp`，早期原生模块预编译分发方案，社区已基本迁移到 `prebuildify`/`prebuild`。仓库里没有遇到用这个框架的上游包。真遇到时，处理思路和"prebuild + prebuild-install"一致（下面那条）——都是"下载/复制其他平台产物到一个约定目录，loader 按平台名找文件"的模式，把 openharmony 产物放进它认的目录结构、改 loader 认标识符即可，不需要额外改造成别的框架。

### prebuild + prebuild-install → 改造成 prebuildify + node-gyp-build

上游用 `prebuild` 构建、`prebuild-install`（配合 `bindings` 包做运行时查找）加载预编译产物。这套框架的运行时查找逻辑（`bindings` 包的启发式搜索）比较绕，改造成等价但更简单的 `prebuildify`（构建期）+ `node-gyp-build`（运行时，纯路径拼接，无启发式）更容易插入 openharmony 分支。

**标杆：仓库内 `ports/sqlite3/5.1.7`**。改造要点（`patchs/0001-change-prebuild-framework.patch`）：

- `package.json`：`dependencies` 去掉 `bindings`+`prebuild-install`，加 `node-gyp-build`；`devDependencies` 的 `prebuild` 换成 `prebuildify`
- 运行时入口文件（sqlite3 是 `lib/sqlite3-binding.js`）：
  ```diff
  -module.exports = require('bindings')('node_sqlite3.node');
  +module.exports = require('node-gyp-build')(__dirname + "/../")
  ```
- `build.sh` 用 `npm run prebuild`（此时已经是 `prebuildify` 提供的脚本）产出 `prebuilds/<platform>/`，其余平台的官方预编译产物从上游 GitHub Release 下载后一并复制进 `prebuilds/`，让这个包在其他平台上依然可用（准入规则："不能破坏其他平台上的行为"）——原始下载的文件名要按 `node-gyp-build` 的命名约定重命名成 `@ohos-npm-ports+<name>.node`（`node-gyp-build` 用 `+` 而不是 `/` 编码 scope，是文件名限制决定的）。

### prebuildify + node-gyp-build（上游本来就是这套框架）

上游已经是 `prebuildify`/`node-gyp-build`，不需要改造框架，直接在已有的 `prebuilds/<platform>-<arch>/` 目录旁边加一个 `openharmony-arm64` 目录即可。

**标杆：仓库内 `ports/bufferutil/4.0.9`**。`npm run prebuild` 编出 OHOS 产物，其余平台产物从已发布的官方 npm tarball 里的 `prebuilds/` 直接复制过来，文件名同样按 `node-gyp-build` 约定重命名（`bufferutil.node` → `@ohos-npm-ports+bufferutil.node`）。

### 纯 node-gyp/nan，产物直接内嵌本包（无多平台分发）

有些包的原生 addon不走任何预构建分发框架——上游预期用户装包时现场编译，或者这个包本来就只服务单一运行环境（不是发布给广泛平台用的通用库）。这种情况不需要 `prebuilds/` 目录，编出来的 `.node` 直接放包里对应位置就行，跟 OHOS 现场编译天然契合。

**标杆：仓库内 `ports/datadog-pprof/5.17.0`**（`node-gyp rebuild` 编译，注意上游 node-gyp 不是 devDependency，需要 `npm install --ignore-scripts --no-save node-gyp` 显式装到 `node_modules/.bin`）、**`ports/parcel-watcher/2.5.1`**。

## napi-rs 系

判断依据：上游用 Rust 写的 N-API binding，`Cargo.toml` 依赖 `napi`/`napi-derive`，`package.json` 的 `devDependencies` 有 `@napi-rs/cli`。

### `napi build --platform` 能识别 openharmony host

容器里 `rustc` 的 host triple 本身就是 `aarch64-unknown-linux-ohos`，新版本的 `@napi-rs/cli` 能正确识别这是 openharmony 平台，`napi build --platform` 直接可用，产出的文件名、`package.json` 里的 `napi.packageName` 平台后缀都由 napi-rs 自己生成好。

**标杆：仓库内 `ports/lightningcss/1.33.0`、`ports/tailwindcss-oxide/4.3.3`**。

### `napi` CLI 版本较老、不认 openharmony host——绕开 `napi build`，直接 `cargo build --release`

上游锁定的 `@napi-rs/cli` 是较老的 2.x 系列，不识别 `openharmony` 这个平台标识，跑 `napi build` 会失败或产出错误的文件名。绕过 CLI，直接 `cargo build --release` 拿到 `.so`（cdylib 产物），再手动按 napi-rs 的命名约定重命名/放置成 loader 期望的路径，效果等价。

**标杆：仓库内 `ports/resvg-resvg-js/2.6.2`（build.sh 头部注释详细说明了这个绕过的理由）、`ports/ast-grep-napi/0.43.0`**。

## 手写 Rust（非 napi-rs，独立可执行文件/原生库）

不是 Node N-API binding，是上游自己用 Rust 写的 CLI 工具或原生库，编译产物是一个独立可执行文件或非 N-API 形态的原生库（走 optionalDependencies 平台包分发，或走 Bun 自己的原生加载机制），不经过 `require()` 直接 dlopen 成 JS 可调用对象那一套。

容器里 `cargo build --release` 直接原生编译（host triple 已经是 `aarch64-unknown-linux-ohos`，不需要配交叉 target）；vendored 依赖（如某些版本的 `nix` crate）没有 OHOS target 支持时，按 [porting-guide.md](porting-guide.md) 的 vendor 补丁手法处理。

**标杆：仓库内 `ports/turbo/2.10.10`**（Rust CLI 主体 + zig 编译的 `libghostty-vt` TUI 部分，产物是独立可执行文件而非 N-API binding）、**`ports/bun-pty/0.4.10`**（专为 Bun 写的原生 pty 库，走 Bun 自己的原生加载机制而非经典 Node N-API，`main` 直接是 TypeScript 源码）。

## 手写 Go

上游用 Go 写了一个原生二进制（编译器、linter 后端等），通过 npm 包分发，Node 侧只是一个薄的 spawn 该二进制的包装层。

Go 静态编译天然适合这个场景：host == target（都是 `aarch64-unknown-linux-ohos`），无 cgo 依赖时直接原生编译即可，产物是单个静态二进制，`-ldflags="-s -w" -trimpath` 减小体积。

**标杆：仓库内 `ports/oxlint-tsgolint/7.0.2001`**（`tsgolint` Go 二进制，源码含 git submodule，`ci-runner` 已装好 git，`git clone`+`git submodule update` 直接用）、**`ports/typescript/7.0.2`**（内嵌 `typescript-go`/`tsgo` 原生编译器的 Go 二进制）。
