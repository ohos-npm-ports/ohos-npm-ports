# 验证标准：怎样才算“跑通了”

“构建成功”不等于“包能用”。原生 addon 可能编译和签名都正确，却因 loader 分支错误而在真实 require() 时崩溃。验证至少分为构建期自证、发布安装和 consumer 功能三层。

## 1. 构建期自验证

NPMBUILD 的 check() 应证明 package() 生成的产物正确，而不是只生成文件。`npm-ports check` 会自动执行 prepare()、build()、package()、check()，无需在钩子内手动串联：

1. **包名/版本断言**：检查 package.json 的 name 和裸上游 version，防止补丁未生效。此时不要断言修订号；最终 `<上游版本>-<revision>` 仅由 `npm-ports pack` 在生成 tarball 前注入。
2. **真实加载**：用 `node -e "require('./index.js')"` 或等价方式实际加载；`node --check` 只能检查语法。有条件时再调用真实功能，例如 parcel-watcher 的 writeSnapshot。
3. **loader 分支命中**：如果补丁增加 openharmony 分支，验证标记确实进入产物，而不是只看 patch 命令退出码。

签名及 `readelf` 检查不属于 NPMBUILD 的贡献者工作。`npm-ports pack` 统一保障 AArch64 ELF 签名，签名工具失败会中断打包。

这些验证属于配方质量要求；lint 只能检查结构，不能替代它们。

## 2. CI 验证边界

构建发生在 ci-runner 容器中。容器通过不代表可直接部署到真机，不覆盖：

- 商用 HarmonyOS 设备的沙箱行为差异；
- 真机代码签名校验细节；
- 真实业务负载下的性能和稳定性。

发布前应根据目标设备补做真机验证。

## 3. 发布前私仓校验

每个配方构建后，CI 对 NPMBUILD 声明的全部产物执行 `pack --no-build`，再发布到临时 Verdaccio：

- dry-run 与真实本地发布的包清单必须一致；
- 主包和槽位包按 packages 顺序发布；
- registry 下载的 tarball 必须来自本临时私仓，SHA-512 与 integrity 一致；
- 在干净目录执行包含 install 脚本的 npm install。

这一步在 PR 和 push 上都执行，不发布到 npm 中心仓。通过后，同一 tarball 和 manifest 上传为 `port-<port>` artifact，保留 7 天。它只证明“包能发布并安装”，不能代替功能测试。

## 4. 多平台 consumer

全部 port 默认进入五平台通用安装矩阵，不需要 `test.js`。runner 根据构建矩阵选择 port，校验 artifact integrity 后通过临时 Verdaccio 安装主包，按 os/cpu 过滤检查槽位、实际安装版本和 bin，再执行 npm ci。全量 dispatch 覆盖全部 port，普通变更覆盖受影响 port；只改 CI 或 consumer 脚本时不重建，测试的是 npm 上已发布的包；没有功能测试文件不会跳过安装验证。

`test.js` 用于补充真实 API、CLI、加载和工程行为。已配置的 primary port 继续在 Windows x64、Linux x64/arm64、macOS arm64 和 OpenHarmony arm64 上运行；普通 OS 比较 baseline 与 overrides，OpenHarmony 验证 overrides。槽位使用同配方 artifact，不另开独立 port job。通用安装通过不等于功能正确，原生加载和关键业务行为仍应在 port 的 check() 或 test.js 中验证。
