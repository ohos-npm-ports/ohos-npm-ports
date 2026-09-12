# CI 流水线

给要理解或维护 `.github/workflows/**` 的人看；贡献者只需要知道「合并前 CI 会跑什么」，见 [../contributor/verification.md](../contributor/verification.md)。

## 触发与整体形状

所有和 port 相关的 workflow 都以 `paths: ["ports/**"]` 过滤，只在 `ports/` 目录有变化时触发：

| workflow | 触发 | 职责 |
|---|---|---|
| `port-lint.yml` | push / PR | 宿主机静态检查：目录形状、patch 引用、commit message 规范（见下） |
| `ci.yml` | push / PR | 容器内 `build.sh` + smoke，`push` 事件额外跑 `publish.sh` |
| `actionlint.yml` | push / PR，限 `.github/workflows/**` | workflow YAML 本身的语法/引用检查 |
| `ports-regression.yml` | 周期调度 | 对一批已收录 port 定期重跑 build+smoke，捕捉上游 tarball 消失/依赖漂移等静默失效 |

## port-lint：秒级、不进容器

`port-lint.sh` 跑在普通 `ubuntu-latest` runner 上，不需要 `ci-runner` 镜像，几秒钟出结果。检查项分两级：

- **阻断**（目录形状类硬错误）：`build.sh`/`publish.sh` 缺失或语法错误、`build.sh` 里出现裸的 `npm publish`、有 patch 文件从未被 `build.sh` 应用、找不到 `@ohos-npm-ports/` scope 引用。这几条在引入时对仓库内**全部现存 port 目录**跑过一遍验证零误报，才定为阻断级。
- **警告**（先观察，不拦 PR）：版本号字符串疑似过期、`build.sh` 缺少可见的自验证痕迹。

`lint-commit-messages.sh` 只检查这次 PR 自己引入的、touch 了 `ports/**` 的 commit，历史 commit 不会被追溯检查（早期提交是自由格式的中文 commit，规范只对将来的提交生效）。

## ci.yml：容器内构建 + smoke + 发布

- `Build` 步骤沿用原有形态：`cd <port-version-dir> && ./build.sh`，跑在 `ghcr.io/ohos-npm-ports/ci-runner` 容器里。
- `Smoke` 步骤紧跟其后，调用 `.github/scripts/smoke-port.sh <port> <version>`——目前是 `continue-on-error: true`（非阻断），先观察一段时间的误报率再考虑收紧。这一步刻意没有并进 `Build` 步骤或改写它：diff 越小，越容易审查，行为回归的风险也越低。
- `Publish` 步骤的触发条件（`if: github.event_name == 'push'`）没有变化——只有直接 push 到 main（通常是 PR 合并后）才会真正发包，PR 本身只构建不发布。

## 已知的容器 shell 限制

`ci-runner` 镜像带 bash；但如果哪天换回不带 bash 的裸鸿蒙容器镜像，容器内运行的一切脚本都要保持 POSIX `sh` 兼容——`port-lint.yml` 这类宿主机 job 不受此限制，可以正常用 bash。

## 容器验证的边界

CI 全程跑在容器里，验证到「编译通过 + 模块可加载」为止，不是真机 HarmonyOS 部署的证明——这个边界写在 [verification.md](../contributor/verification.md)，维护者审 PR 时不应把「容器 CI 全绿」等同于「真机上没问题」。
