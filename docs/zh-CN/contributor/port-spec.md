# Port 规范：目录、命名、版本、patch

本文档归纳自仓库内现有 20+ 个 port 的共同结构。跟已有包（尤其是移植手法接近的）抄起，别从零发明格式。

## 目录形状

```
ports/<port>/<version>/
├── build.sh       # 必须：拉源码/上游产物 → 打补丁 → 编译/重打包 → 自验证
├── publish.sh     # 必须：cd 到构建产物目录 → npm publish
└── patchs/        # 可选（无需改动上游文件时可以没有）
    ├── 0001-xxx.patch
    └── 0002-xxx.patch
```

- `<port>` 用不带 scope 的短横线命名；上游是 scoped 包（如 `@ast-grep/napi`）时，目录名按 `scope-name` 惯例展开（`@ast-grep/napi` → `ast-grep-napi`，`@datadog/pprof` → `datadog-pprof`，`@resvg/resvg-js` → `resvg-resvg-js`）——目录名和最终发布名的对应关系必须一眼看出来。
- `<version>` 是**上游基准版本号**（不含本仓库的修订后缀），如 `5.1.7`、`0.5.8`。同一个包可以有多个版本目录并存（`opentui-core` 现有 `0.4.5` 和 `0.5.8` 两代）——旧版本目录何时删除由维护者决定，不在贡献者范围内。
- 平台专属子包（如 `@parcel/watcher` 的 openharmony 二进制槽位）独立开一个 `ports/<port>-openharmony-arm64/<version>/` 目录，不要塞进主包目录。

## build.sh

必须是 `#!/bin/sh`（POSIX，见 [contributing.md](contributing.md) 的容器无 bash 说明），`set -e` 起手。

**分区规范（formula 生命周期同构）**：brew formula 作者只见声明区 + `install` + `test`，是因为 brew 替他做了其余阶段（deps 解析、fetch+校验、pour/bottle）。build.sh 没有 brew——**它自己就是 brew**，所以要按 brew 内部流水线分五区，每区一个 POSIX sh 函数 + 分区横幅，底部按序调用：

```sh
# ============================== deps ==============================
# 工具链与环境：brew 缺啥装啥（bun 等）、环境桥接（如容器 /system loader symlink）、
# 仅 test 脚手架用的工具链（如 zig）也在此获取（sha256 钉死）。
# ============================== fetch ==============================
# 物料下载：上游源码 tarball / 已发布 npm 包，加固 CURL + sha256 钉死。
# ============================== build ==============================
# 补丁（patch -p1 + marker grep 复验，toybox patch 静默 no-op）→ 上游构建命令或
# 交叉编译 → 重建产物拼接/组装。到「未签名产物」为止。
# ============================== package ==============================
# 发布形态收尾：**签名**（llvm-strip + binary-sign-tool，只属于随包发给用户的
# 产物）+ 元数据终态（package.json patch）+ 形态断言（父包无 .so 等）。
# ============================== test ==============================
# 校验与真跑，静态在前动态在后（fail fast）：包静态断言（node --check / 标记
# grep / readelf / optionalDependencies）→ e2e 真跑（装进 node_modules：渲染 /
# require / compile 内嵌）。test 需要的脚手架（如冒烟用 native）在 test 内自建，
# 与发布物同源同参但不签名。
```

规则：

- **五个函数**：`do_deps` / `do_fetch` / `do_build` / `do_package` / `do_test`（不叫 `install`/`test`——避免遮蔽同名命令），底部按序调用，等价 brew 的流水线步骤。
- **跨函数路径一律 `${ROOT}/` 绝对化**。函数会切 CWD，相对元变量在校验时是假阴性高发区（PR #41 分区化实测两次 CI 实挂：zig 非终端静默成功，产物检查因路径翻倍而假失败）。
- **签名边界 = package 阶段**：`package` 最后一步必是签名（有发布物）或形态终检（纯 JS/无发布物可签）。
- **范式由 port-lint 阻断检查**：横幅必须恰为 `deps→fetch→build→package→test` 顺序、`do_*` 五函数必须齐全（`port-lint.sh` BLOCKING）。存量 port 只在被触碰（版本修订/修复）时需要补分区——这是有意的 migrate-on-touch 强制力，不做 style-only 批量改版（同版本重发 npm 409）。
- **签名只属于发布物**：随包发给用户的 .so/二进制才 `llvm-strip` + `binary-sign-tool`；构建期/冒烟产物不签（CI 容器内核不做签名校验）。
- 参考实现：`ports/opentui-core/0.5.8/build.sh`（JS 源码重建 + 槽位双包 + e2e 冒烟）、`ports/opentui-core-openharmony-arm64/0.5.8/build.sh`（纯 native 槽位包）。

分区内的典型内容：

1. `curl` 拉取上游源码 tarball 或已发布的 npm 包（`npm pack <name>@<version>`）。
2. 按需应用 `patchs/*.patch`（`patch -p1 < "${PORT_DIR}/patchs/xxx.patch"`）。
3. 编译原生 addon（node-gyp / zig 交叉编译 / cargo 均有先例）或直接重打包已有产物。
4. **自验证**（见 [verification.md](verification.md)）——`readelf` 校验签名与架构、`node -e` 真实 `require()`、必要时跑一次真实功能调用。
5. 打印一行 `OK: ...` 收尾。

**build.sh 里绝不能出现 `npm publish`**——发布永远是 `publish.sh` 的职责，`ci.yml` 靠这个边界决定「构建」和「只在 push/合并时才发布」两个阶段能不能拆开触发。

## publish.sh

固定两行模式：

```sh
#!/bin/sh
set -e
cd <构建产物目录>
npm publish --tag latest --access public
```

第二行的 `cd` 目标是「构建产物目录」——CI 的门禁脚本靠 `sed -n 's/^cd //p' publish.sh` 取出这一行、再用 `sh -c "cd <取出的内容> && pwd"`（`$0` 绑定成 `publish.sh` 自身路径）求出真实目录，不是死抠字面量文本。两种写法都可以：

- 字面量相对路径最简单：`cd sqlite3-5.1.7`（绝大多数 port 用这个）
- 平台专属子包可以用 `cd "$(dirname "$0")/<pkg>-<ver>"`（`parcel-watcher-openharmony-arm64`、`opentui-core-openharmony-arm64` 先例）——`$0` 保证不依赖调用者的 cwd 就能定位到脚本自己所在目录

不要用别的形式（函数包一层、多行拼接等）——门禁脚本只认这一行、只 eval 这一行，写复杂了会解析不出来。

## 包名与版本号

- `package.json` 的 `name` 字段改成 `@ohos-npm-ports/<port>`。这个改写可能来自三种载体，任选其一：
  - 打补丁改写 fetch 下来的上游 `package.json`（最常见，通常在 `0001-update-package-json.patch`）
  - `build.sh` 里用 heredoc 直接生成整份 `package.json`（平台专属子包这类没有「上游 package.json」可改的场景）
  - port 目录里直接放一份静态 `package.json`，`build.sh` 用 `cp` 复制进构建产物（commit-pin 类的原生构建，如 `prisma-engines`）
- `version` 字段改成 `<上游版本>-<修订号>`（`5.1.7-8`）。修订号只在**补丁本身**改进时才 +1，不随上游发版自动变化；升级到新的上游版本要新开一个 `<version>` 目录，修订号从 `-1` 重新起。
- `repository.url` 指回本仓库（`https://github.com/ohos-npm-ports/ohos-npm-ports`），不要留着上游原仓库地址。

## patch 命名与纪律

- 编号前缀 `NNNN-`（四位数字，从 `0001` 起），描述用短横线连词：`0001-update-package-json.patch`。
- **每个 patch 必须被 build.sh 实际应用**：要么按文件名逐条 `patch -p1 < ../patchs/0001-xxx.patch`，要么整体 glob 循环 `for patch in ../patchs/*.patch; do patch -p1 < "$patch"; done`（`playwright-core` 用的是后者——patch 数量多、顺序靠文件名排序时更省事）。没被应用到的 patch 文件是死代码，CI 的 `port-lint` 会拦下来。
- **改已有 patch 要重新生成 diff，不要手改 `@@` 行号**——上游文件哪怕只挪动几行，手改的行号在 `patch` 工具下常常静默不生效（打完补丁退出码是 0，但内容根本没变），验证靠 grep 补丁引入的标记字符串，不要只看退出码。
- 一个 patch 可以身兼数职（`sqlite3` 的唯一 patch 同时改了 `binding.gyp`、`lib/sqlite3-binding.js` 和 `package.json`）——不必强行拆成「一个改动一个 patch」，只要每个改动本身内聚。

## 校验规则来源

`port-lint.sh` 的阻断级规则都是先对仓库里全部现存 port 目录跑一遍确认零误报，再定为阻断（见该脚本头部注释）；仍在观察阶段的规则（版本号字符串是否过期、build.sh 是否有自验证）先只报警告，不拦截 PR。
