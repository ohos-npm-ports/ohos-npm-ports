# CI 流水线

给要理解或维护 `.github/workflows/**` 的人看；贡献者只需要知道“合并前 CI 会跑什么”，见 [../contributor/verification.md](../contributor/verification.md)。

## 1. 触发与整体形状

`ci.yml` 和 `port-lint.yml` 使用 `paths: ["ports/**"]` 过滤，只在 `ports/` 目录有变化时触发；自动升级、版本报告和周期回归按各自的调度或手动触发规则运行：

| workflow | 触发 | 职责 |
|---|---|---|
| `port-lint.yml` | PR | 宿主机静态检查：目录形状、patch 引用、commit message 规范（见下） |
| `ci.yml` | push / PR | 容器内运行 `build.sh`；`push` 事件额外运行 `publish.sh` |

## 2. port-lint：秒级、不进容器

`port-lint.sh` 跑在普通 `ubuntu-latest` runner 上，不需要 `ci-runner` 镜像，几秒钟出结果。检查项分两级：

- **阻断**（目录形状类硬错误）：`build.sh`/`publish.sh` 缺失或语法错误、`build.sh` 里出现裸的 `npm publish`、有 patch 文件从未被 `build.sh` 应用、找不到 `@ohos-npm-ports/` scope 引用。这几条在引入时对仓库内**全部现存 port 目录**跑过一遍验证零误报，才定为阻断级。
- **警告**（先观察，不拦 PR）：版本号字符串疑似过期、`build.sh` 缺少可见的自验证痕迹。

`lint-commit-messages.sh` 只检查这次 PR 自己引入的、touch 了 `ports/**` 的 commit，历史 commit 不会被追溯检查（早期提交是自由格式的中文 commit，规范只对将来的提交生效）。

## 3. ci.yml：容器内构建与发布

- `Build` 步骤运行 `cd <port-version-dir> && ./build.sh`。
- `Publish` 步骤的触发条件（`if: github.event_name == 'push'`）没有变化——只有直接 push 到 main（通常是 PR 合并后）才会真正发包，PR 本身只构建不发布。

## 4. 容器验证的边界

CI 在容器内完成构建，不是真机部署证明。目标设备上的签名、沙箱和业务行为仍需单独验证。
