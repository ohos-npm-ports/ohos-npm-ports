# 验证标准：怎样才算"跑通了"

"`build.sh` 编译成功"不等于"这个包能用"——一个原生 addon 完全可以编译通过、签名正确，但因为 loader 分支写错而在真实 `require()` 时崩溃或走错平台分支。CI 只在这条线之前拦得住的错误，不代表用户装上就能用。本文档定义两层验证，以及它们各自覆盖到哪、不覆盖到哪。

## 1. build.sh 自验证

`build.sh` 结尾应当自己证明产物是对的，而不是只把文件放在那里就收工。参照仓库里大多数 port 的写法，一个完整的自验证至少覆盖：

1. **包名/版本断言**：`node -e "if (require('./package.json').name !== '@ohos-npm-ports/<port>') throw ..."`，防止补丁改写位置错、name 字段没生效。
2. **二进制签名与架构**（涉及 `.node`/`.so` 时）：
   ```sh
   readelf -h <binding>.node | grep -q 'AArch64'
   readelf -S <binding>.node | grep -q '\.codesign'
   ```
   鸿蒙商用发行版（HarmonyOS）会对 ELF 做代码签名校验，没签名的产物装上也用不了。使用带签名支持的 OHOS 工具链构建，或对其他工具链产物执行 `binary-sign-tool sign -selfSign 1`。
3. **真实加载**：入口必须用 `node -e "require('./index.js')"` 或等价方式实际加载；`node --check` 只能检查 JavaScript 语法，不能替代加载测试。有条件的话再调一次真实功能（`opentui-core` 的 dlopen 探测、`parcel-watcher-openharmony-arm64` 的 `writeSnapshot` 真实调用都是这个层级）。
4. **loader 分支命中检查**：如果补丁给上游 loader 加了 `process.platform === 'openharmony'` 分支，就在自验证里 `grep` 一下这个分支真的进了产物文件，而不是假设补丁打上去了就万事大吉。

这不是选做项——CI 的 `port-lint` 会对没有任何自验证痕迹（`grep -q`/`node -e`/`readelf`）的 `build.sh` 发警告（目前非阻断，仓库里 `bufferutil`/`sqlite3`/`typescript` 三个包是已知的历史缺口，正在补）。

## 2. CI smoke

`ci.yml` 会把构建目录打包后安装到临时工程；如果包声明了 `main` 或 `exports`，CI 会加载该入口。当前 smoke 为非阻断检查，用于发现“编译成功但安装后无法加载”的问题。

自动升级和周期回归使用同类的构建后加载检查，但失败会阻止对应的自动化任务继续创建或报告成功结果。

## 3. CI 验证边界

当前 CI 的构建验证发生在 `ci-runner` 容器里。容器通过不代表可以直接部署到真机，发布前应根据目标设备补做真机验证。

**不覆盖**：

- 真实 HarmonyOS（商用发行版，非社区版 OpenHarmony）设备上的沙箱行为差异
- 真机上的代码签名校验细节（容器的签名校验通常比真机宽松）
- 真实业务负载下的性能/稳定性

容器验证不能替代真机验证。
