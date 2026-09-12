# 验证标准：怎样才算「跑通了」

「`build.sh` 编译成功」不等于「这个包能用」——一个原生 addon 完全可以编译通过、签名正确，但因为 loader 分支写错而在真实 `require()` 时崩溃或走错平台分支。CI 只在这条线之前拦得住的错误，不代表用户装上就能用。本文档定义两层验证，以及它们各自覆盖到哪、不覆盖到哪。

## 第一层：build.sh 自验证（贡献者必须做）

`build.sh` 结尾应当自己证明产物是对的，而不是只把文件放在那里就收工。参照仓库里大多数 port 的写法，一个完整的自验证至少覆盖：

1. **包名/版本断言**：`node -e "if (require('./package.json').name !== '@ohos-npm-ports/<port>') throw ..."`，防止补丁改写位置错、name 字段没生效。
2. **二进制签名与架构**（涉及 `.node`/`.so` 时）：
   ```sh
   readelf -h <binding>.node | grep -q 'AArch64'
   readelf -S <binding>.node | grep -q '\.codesign'
   ```
   鸿蒙商用发行版（HarmonyOS）会对 ELF 做代码签名校验，没签名的产物装上也用不了。用 Harmonybrew 的 ohos-sdk 构建，产物默认自带签名；用其他工具链构建的要自己调用 `binary-sign-tool sign -selfSign 1` 补签。
3. **真实加载**：`node -e "require('./index.js')"` 或直接 `node --check` 全部 `.js` 文件语法；有条件的话再调一次真实功能（`opentui-core` 的 dlopen 探测、`parcel-watcher-openharmony-arm64` 的 `writeSnapshot` 真实调用都是这个层级）。
4. **loader 分支命中检查**：如果补丁给上游 loader 加了 `process.platform === 'openharmony'` 分支，就在自验证里 `grep` 一下这个分支真的进了产物文件，而不是假设补丁打上去了就万事大吉。

这不是选做项——CI 的 `port-lint` 会对没有任何自验证痕迹（`grep -q`/`node -e`/`readelf`）的 `build.sh` 发警告（目前非阻断，仓库里 `bufferutil`/`sqlite3`/`typescript` 三个包是已知的历史缺口，正在补）。

## 第二层：CI 的 smoke 门禁（自动兜底）

`build.sh` 跑完之后，CI 会额外做一次通用 smoke：`npm pack` 出 tgz → 装进一个干净的临时工程 → 如果 `package.json` 有 `main`/`exports` 就真 `require()` 一次。这一层的意义是即使贡献者忘了写第一层自验证，产物也不会带着「装不上/require 直接崩」的问题被合并。

- port 目录下放一个可选的 `smoke.sh`（cwd = 构建产物目录）可以覆盖默认的通用 smoke，跑更贴合这个包的检查。
- 这一层目前是**非阻断**（`continue-on-error`）——先观察一段时间的误报率，稳定后再考虑收紧成阻断。

## 明确的盲区：容器验证 ≠ 部署证明

CI 的一切验证都发生在 `ci-runner` 容器里。容器验证到「编译通过 + 模块能被加载」为止，**不覆盖**：

- 真实 HarmonyOS（商用发行版，非社区版 OpenHarmony）设备上的沙箱行为差异
- 真机上的代码签名校验细节（容器的签名校验通常比真机宽松）
- 真实业务负载下的性能/稳定性

merge 与发布由维护者裁决；有条件的话建议真机复测，但**不阻塞**——容器 CI 通过就可以合并，真机问题事后再修。这个取舍是刻意的：真机资源不是每个贡献者都有，CI 门禁的目标是「拦住肉眼可见的错误」，不是「保证生产级质量」。
