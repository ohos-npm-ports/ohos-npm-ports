# Port 规范：目录、命名、版本、patch

本文档归纳自仓库内现有 20+ 个 port 的共同结构。跟已有包（尤其是移植手法接近的）保持一致，别从零发明格式。

## 1. 目录形状

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

## 2. build.sh

`build.sh` 必须使用 `#!/bin/sh` 和 `set -e`，并按以下顺序完成构建：

`build.sh` 和 `publish.sh` 统一使用 POSIX sh 语法，不支持 bash 或 zsh 等扩展语法。

1. 下载源码或上游包，并固定来源；新增或升级 port 必须提供下载文件的校验值。
2. 应用 `patchs/` 下的补丁，随后检查补丁引入的关键标记。
3. 编译原生 addon 或原生二进制。
4. 组装发布目录，写入最终的 `package.json`，并对随包分发的原生文件签名。
5. 执行静态检查和必要的真实加载检查。

构建过程可以拆成函数，但不要求所有 port 使用同一套函数名或横幅。跨函数切换目录时使用稳定的绝对路径，避免检查阶段因当前目录变化而误判。

构建脚本不得执行 `npm publish`；发布由 `publish.sh` 负责。

## 3. publish.sh

固定模式：

```sh
#!/bin/sh
set -e
cd <构建产物目录>
npm publish --tag latest --access public
```

第二行的 `cd` 目标是“构建产物目录”——CI 的门禁脚本靠 `sed -n 's/^cd //p' publish.sh` 取出这一行、再用 `sh -c "cd <取出的内容> && pwd"`（`$0` 绑定成 `publish.sh` 自身路径）求出真实目录，不是死抠字面量文本。两种写法都可以：

- 字面量相对路径最简单：`cd sqlite3-5.1.7`（绝大多数 port 用这个）
- 平台专属子包可以用 `cd "$(dirname "$0")/<pkg>-<ver>"`（`parcel-watcher-openharmony-arm64`、`opentui-core-openharmony-arm64` 先例）——`$0` 保证不依赖调用者的 cwd 就能定位到脚本自己所在目录

不要用别的形式（函数包一层、多行拼接等）——门禁脚本只认这一行、只 eval 这一行，写复杂了会解析不出来。

**`--tag latest` 只属于这个包当前真正应该分发给新用户的那条版本线**。一个包如果有多个 `<version>` 目录并存（如 `opentui-core` 的 `0.4.5` 和 `0.5.8`），只有其中最新的那条线的 publish.sh 才写 `--tag latest`；给较旧那条线发修订版（比如给 `0.4.5` 修一个只有那条线才有的 bug）时，必须显式换一个不同的 tag（如 `--tag legacy-0.4`），不能照抄模板漏改——npm 的 `latest` dist-tag 谁发布得晚就是谁，跟 semver 版本号大小无关：如果 `0.5.8` 已经是 `latest`，之后再发一次 `0.4.5-2` 却还打 `--tag latest`，`latest` 会被错误地拉回 `0.4.5-2`，新装的用户全部拿到旧版本。新增 port 只有一条版本线时无需关心这条，正常照抄模板即可。

## 4. 包名与版本号

- `package.json` 的 `name` 字段改成 `@ohos-npm-ports/<port>`。这个改写可能来自三种载体，任选其一：
  - 打补丁改写 fetch 下来的上游 `package.json`（最常见，通常在 `0001-update-package-json.patch`）
  - `build.sh` 里用 heredoc 直接生成整份 `package.json`（平台专属子包这类没有“上游 package.json”可改的场景）
  - port 目录里直接放一份静态 `package.json`，`build.sh` 用 `cp` 复制进构建产物（commit-pin 类的原生构建，如 `prisma-engines`）
- `version` 字段改成 `<上游版本>-<修订号>`（`5.1.7-8`）。修订号只在**补丁本身**改进时才 +1，不随上游发版自动变化；升级到新的上游版本要新开一个 `<version>` 目录，修订号从 `-1` 重新起。
- `repository.url` 指回本仓库（`https://github.com/ohos-npm-ports/ohos-npm-ports`），不要留着上游原仓库地址。

## 5. patch 命名与纪律

- 编号前缀 `NNNN-`（四位数字，从 `0001` 起），描述用短横线连词：`0001-update-package-json.patch`。
- **每个 patch 必须被 build.sh 实际应用**：要么按文件名逐条 `patch -p1 < ../patchs/0001-xxx.patch`，要么整体 glob 循环 `for patch in ../patchs/*.patch; do patch -p1 < "$patch"; done`（`playwright-core` 用的是后者——patch 数量多、顺序靠文件名排序时更省事）。没被应用到的 patch 文件是死代码，CI 的 `port-lint` 会拦下来。
- **改已有 patch 要重新生成 diff，不要手改 `@@` 行号**——上游文件哪怕只挪动几行，手改的行号在 `patch` 工具下常常静默不生效（打完补丁退出码是 0，但内容根本没变），验证靠 grep 补丁引入的标记字符串，不要只看退出码。
- 一个 patch 可以身兼数职（`sqlite3` 的唯一 patch 同时改了 `binding.gyp`、`lib/sqlite3-binding.js` 和 `package.json`）——不必强行拆成“一个改动一个 patch”，只要每个改动本身内聚。

## 6. 校验规则来源

`port-lint.sh` 的阻断级规则都是先对仓库里全部现存 port 目录跑一遍确认零误报，再定为阻断（见该脚本头部注释）；仍在观察阶段的规则（版本号字符串是否过期、build.sh 是否有自验证）先只报警告，不拦截 PR。来源校验值尚未覆盖全部存量 port，新增或升级 port 不得新增缺少校验值的例外，存量 port 另行补齐。
