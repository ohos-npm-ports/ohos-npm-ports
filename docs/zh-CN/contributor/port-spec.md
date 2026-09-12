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

必须是 `#!/bin/sh`（POSIX，见 [contributing.md](contributing.md) 的容器无 bash 说明），`set -e` 起手。典型流程：

1. `curl` 拉取上游源码 tarball 或已发布的 npm 包（`npm pack <name>@<version>`）。
2. 按需应用 `patchs/*.patch`（`patch -p1 < ../patchs/xxx.patch`）。
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

第二行的 `cd` 目标是「构建产物目录」——CI 的门禁脚本靠 `sed -n 's/^cd //p' publish.sh` 解析这一行来定位产物，**必须是字面量相对路径**，不要用变量或函数包一层。

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
