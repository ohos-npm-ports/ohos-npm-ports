# CI 流水线

给要理解或维护 `.github/workflows/**` 的人看；贡献者只需要知道"合并前 CI 会跑什么"，见 [../contributor/verification.md](../contributor/verification.md)。

## 触发与整体形状

所有和 port 相关的 workflow 都以 `paths: ["ports/**"]` 过滤，只在 `ports/` 目录有变化时触发：

| workflow | 触发 | 职责 |
|---|---|---|
| `port-lint.yml` | PR，限 `ports/**` | 宿主机静态检查：目录形状、patch 引用、commit message 规范 |
| `ci.yml` | push / PR，限 `ports/**` | 容器内运行 `build.sh`；随后运行非阻断 smoke；`push` 事件额外运行 `publish.sh` |
| `actionlint.yml` | push / PR，限 workflow 文件 | 检查 workflow 语法、表达式和 shell 片段 |
| `autobump.yml` | 每日调度 / 手动触发 | 检查白名单 port 的上游版本，验证后创建升级 PR |
| `ports-report.yml` | 每周调度 / 手动触发 | 报告所有 port 与上游版本的差异 |
| `ports-regression.yml` | 每周调度 / 手动触发 | 重新构建并加载全部 port，发现依赖或上游资源失效 |

## port-lint：秒级、不进容器

`port-lint.sh` 跑在普通 `ubuntu-latest` runner 上，不需要 `ci-runner` 镜像，几秒钟出结果。检查项分两级：

- **阻断**（目录形状类硬错误）：`build.sh`/`publish.sh` 缺失或语法错误、`build.sh` 里出现裸的 `npm publish`、有 patch 文件从未被 `build.sh` 应用、找不到 `@ohos-npm-ports/` scope 引用。这几条在引入时对仓库内**全部现存 port 目录**跑过一遍验证零误报，才定为阻断级。
- **警告**（先观察，不拦 PR）：版本号字符串疑似过期、`build.sh` 缺少可见的自验证痕迹。

`lint-commit-messages.sh` 只检查本次 PR 中改动 `ports/**` 的 commit。

## ci.yml：容器内构建、smoke 与发布

- `Build` 步骤运行 `cd <port-version-dir> && ./build.sh`。
- `Smoke` 将构建目录打包后安装到临时工程，并加载包的入口；当前为非阻断检查。
- `Publish` 只在 `push` 事件运行，PR 本身不发布。

## 容器验证的边界

CI 在容器内完成构建，不是真机部署证明。目标设备上的签名、沙箱和业务行为仍需单独验证。
