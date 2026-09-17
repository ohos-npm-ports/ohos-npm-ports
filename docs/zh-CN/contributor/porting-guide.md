# 移植路径判定

一个 npm 包在鸿蒙上装不上/跑不起来，先按下面顺序判断该走哪条路，而不是直接动手写补丁。

## 1. 上游支持情况

Node.js 运行时本身已经支持鸿蒙（见 [官方文档](https://github.com/nodejs/node/blob/main/BUILDING.md)），但这不代表每个 npm 包都支持——尤其是带原生 addon（`.node`）的包。

**上游最新版有没有原生加上 `openharmony` 分支**：看 loader 源码（`js-binding.js`/`binding.js`/`lib/*.cjs` 等）有没有识别 `process.platform === 'openharmony'`，有没有发布 `openharmony-arm64`/`linux-arm64-ohos` 这类平台子包（不同工具链命名不统一，两套都要试）。已经支持的话，用户直接升级上游版本就好，不需要本仓库介入。

只有确认上游还没支持，才轮到本仓库收录——`@ohos-npm-ports` 这套生态应当自洽，不依赖其他第三方 scope 的产物（依赖别的 scope 会让用户多一层“这个包到底该装哪个”的困惑）。

## 2. 问题类型与修复模式

### 2.1 缺平台二进制

原生 addon 只发布了 darwin/linux(glibc)/win32 的预编译产物，没有 openharmony 的。统一走**源码构建**：容器内原生编译（见下面“工具链要点”，不同构建框架的具体打法见 [build-frameworks.md](build-frameworks.md)），产物签名后塞进重打包的 npm 包里。

OpenHarmony 产物必须通过源码构建。其他平台的预编译产物可以在来源、ABI、签名和功能都经过验证后复用，并随包分发；不能用其他平台产物替代 OpenHarmony 目标产物。

### 2.2 `dlopen` 失败 / SIGSYS 崩溃

原生二进制存在，但加载或运行时崩溃，通常是下面几类之一：

- **未签名**：鸿蒙商用发行版对 ELF 做代码签名校验，没有 `.codesign` section 的产物装上也用不了。使用带签名支持的 OHOS 工具链构建，或对其他工具链产物执行 `binary-sign-tool sign -selfSign 1`。
- **UND 符号在 dlopen 时未能全部解析**：OHOS musl 的动态链接器不做 lazy binding——`.so`/`.node` 里凡是引用到但没定义的符号，dlopen 那一刻就必须全部能解析到，缺一个就整体加载失败（不是“没调用到就不炸”那套 glibc 习惯）。常见于 addon 依赖某个 musl 缺失的符号（如 `pthread_tryjoin_np`）；修法是给这个符号加 weak 声明 + 运行时判空回退（C/C++ 用 `__attribute__((weak))`；zig 用 `.linkage = .weak` 声明为 optional，`orelse` 兜底）。
- **无条件探测的 syscall 直接被内核杀掉**：鸿蒙内核对某些 syscall（`fanotify_init`、`close_range` 等）返回 SIGSYS 而不是 `ENOSYS`，代码里“先探测再决定要不要用”的防御逻辑根本没机会跑到 err 分支。修法是运行时判内核类型（`uname()` 识别 HongMeng/HarmonyOS）直接跳过探测，走上游本来就有的降级路径（很多项目对 Android 已经有类似的特判，抄它的路径最省事）。
- **dlopen 出来的模块无法回溯解析主程序符号**：鸿蒙动态链接器做了命名空间隔离，dlopen 加载的模块默认看不到主二进制导出的符号（zsh/ruby/perl 一类的插件机制都会遇到）。链接时加 `-Wl,-z,global` 恢复类似标准 Linux 的全局符号可见性。
- **C++ ABI 边界**：调用方和宿主必须是同一套 C++ 标准库实现（都是 libstdc++ 或都是 libc++），mangled name 不同没有编译选项能桥接——静态链了某个 libstdc++ 版本的 Node.js 无法加载 libc++ 编译的 addon，反之亦然。

## 3. 工具链要点

- **Rust**：容器里 `rustc` 的 host triple 本身就是 `aarch64-unknown-linux-ohos`，`cargo`/`napi build --platform` 原生构建即可，不需要配交叉 target。`napi-rs` 不同大版本对 openharmony host 的支持程度不一样——2.x 系可能不认 openharmony host（这时候绕开 `napi build`，直接 `cargo build --release` 再把产物改名成 loader 认的文件名），3.x 系平台名固定 `openharmony-arm64`；各家 loader 命名也不统一（有的用 `openharmony-arm64`，有的走自定义的 `linux-arm64-ohos`），动手前先读目标包的 loader 源码确认它实际认哪个名字。
- **Zig**：交叉编译选 `aarch64-linux-musl` target，不要选 `aarch64-linux-ohos`——后者的产物会引用 OHOS libc 没有的 `__emutls_get_address`，反而跑不起来；`aarch64-linux-musl` 产物和上游官方发布的 musl 版本结构一致，能直接复用。
- **Go**：无 cgo 且依赖允许时可以静态编译；存在 cgo 或动态依赖时，需要额外处理库路径和签名。`-ldflags="-s -w" -trimpath` 可用于减小体积。
- **vendored 依赖打补丁**：Rust 生态里一些老版本 crate（如某些版本的 `nix`）没有 OHOS target 支持，而项目又用 `^0.x` semver 锁死版本导致无法直接升级——这时改走 vendor 一份新版本源码，用 `[patch.crates-io]` 或直接替换 vendor 目录里的版本号来打补丁（`[patch.crates-io]` 本身跨不了 0.x 的 minor 版本边界，不能只改 `Cargo.toml` 里的版本号了事）。
- `ci-runner` 镜像已经包含 `git`，`git clone`/`git submodule` 都能用（`oxlint-tsgolint` 就是这么拉 `typescript-go` 子模块的）；但没有子模块、只是拉一份 tag 源码的场景，`curl` 直接拉 GitHub 的 `codeload.github.com` tarball 更快也更省——两种方式都合理，按实际需要选。

## 4. npm 生态注意事项

- `npm install file:<目录>` 是 symlink 安装，不会装该包自己的依赖；要正常解析依赖必须先 `npm pack` 出 tarball 再装。
- 未签名的 `.node`/`.so`：消费方用 npm/pnpm 装的话需要额外的签名步骤（如 `ohos-signpost` 一类的 postinstall 钩子）；用 bun 安装/构建的话通常内置了签名处理。
- 上游 `package.json` 的 `packageManager` 字段（比如指定 `pnpm@x`）如果所指定的包管理器在 openharmony 平台没有对应发布，重打包时要把这个字段删掉，否则消费方那边会因为解析不到对应平台的可执行文件而失败。

不同构建框架（node-gyp 系 / napi-rs 系 / 手写 Rust / 手写 Go）具体怎么打包见 [build-frameworks.md](build-frameworks.md)。
