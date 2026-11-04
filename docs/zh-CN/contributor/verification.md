# 验证标准

“构建成功”不等于“包能用”。原生 addon 可能编译和签名都正确，却因 loader 分支错误而在真实 require() 时崩溃。验证分为构建阶段断言、发布安装和 consumer 功能测试，但配方只有一个功能测试入口：`test.mjs`。

## 1. 构建阶段断言

NPMBUILD 不再设置独立的 `check()` 阶段。源码和产物断言放在对应的生命周期中：

1. `build()` 验证源码哈希、必要的移植约束、编译结果和上游测试。
2. `package()` 验证发布目录的文件布局、loader 接线、manifest 中的 port 特有约束和入口语法。
3. normalize 统一注入并验证全部发布包的名称、repository、最终发布版本和同 port 槽位引用，不需要配方重复断言这些通用字段。

`npm-ports package` 自动执行 `prepare()`、`build()`、`package()` 和 normalize。`package()` 结束时产物保持裸上游版本，随后由框架完成规范化。签名及 `readelf` 检查不属于 NPMBUILD，`npm-ports pack` 统一保障 AArch64 ELF 签名。

真实 `require()`、API、CLI 和工程行为如果需要验证安装后的包，应放在 `test.mjs`，不要在构建阶段重复实现一套消费测试。`npm-ports lint` 只能检查结构，不能替代这些真实验证。

## 2. 本地提交前验证

在 ci-runner 容器中按以下顺序检查单个 port：

```sh
npm-ports lint <port>
npm-ports package <port>
npm-ports validate-publish <port>
```

- `npm-ports lint` 检查配方结构和静态约束。
- `npm-ports package` 执行完整构建生命周期、包断言和 normalize。
- `npm-ports validate-publish` 打包全部产物、发布到临时 Verdaccio、校验 tarball 和 integrity，并在干净目录实际安装。

需要排除旧构建产物影响时，先执行 `npm-ports clean <port>`。该命令保留源码和下载缓存，但会删除 artifacts，因此 clean 后必须重新构建，不能立即使用 `--no-build`。

每个 port 都必须提供 `test.mjs`，并执行：

```sh
npm-ports test <port>
```

`npm-ports test` 默认重新构建并打包，再通过临时 registry 安装并在当前平台运行功能测试。已有当前源码生成的 artifacts 时可用 `npm-ports test <port> --no-build` 复用。日常发布检查使用 `npm-ports publish --dry-run` 或临时 Verdaccio，不发布到 npm 中心仓。

`test.mjs` 默认导出测试函数，返回 `{ result, assets? }`。runner 提供 `requirePackage`、`importPackage`、`resolvePackage`、`run`、`mode`、`version`、`revision` 和 `projectDir` 等上下文。`version` 和 `revision` 与 NPMBUILD 中的含义相同，需要最终发布版本时使用 `${version}-${revision}`。测试通过上下文加载安装后的包，不直接依赖仓库中的 node_modules，也不手工写报告文件。复杂的辅助测试可以放在 port 的其他文件中。

安装前准备使用命名导出的 `setup(context)`，并在文件头声明 `// @test-setup: true`。setup 在 npm install 和 npm ci 前运行，可以补充依赖或准备 fixture。

## 3. CI 验证边界

构建发生在 ci-runner 容器中。容器通过不代表可直接部署到真机，不覆盖：

- 商用 HarmonyOS 设备的沙箱行为差异。
- 真机代码签名校验细节。
- 真实业务负载下的性能和稳定性。

发布前应根据目标设备补做真机验证。

## 4. CI 发布前私仓校验

每个配方构建后，CI 对 NPMBUILD 声明的全部产物执行 `npm-ports pack --no-build`，再发布到临时 Verdaccio：

- dry-run 与真实本地发布的包清单必须一致。
- 主包和槽位包按 packages 顺序发布。
- registry 下载的 tarball 必须来自本临时私仓，SHA-512 与 integrity 一致。
- 在干净目录执行包含 install 脚本的 npm install。

这一步在 PR 和 push 上都执行，不发布到 npm 中心仓。通过后，同一 tarball 和 manifest 上传为 `port-<port>` artifact，保留 7 天。它只证明“包能发布并安装”，不能代替功能测试。

## 5. 多平台 consumer

全部 port 默认进入五平台通用安装矩阵，并必须提供 `test.mjs`。runner 根据构建矩阵选择 port，校验 artifact integrity 后通过临时 Verdaccio 安装主包，按 os/cpu 过滤检查槽位、实际安装版本和 bin，再执行 npm ci。全量 dispatch 覆盖全部 port，普通变更覆盖受影响 port。只改 CI 或 consumer 脚本时只测 `sentinel-ports.json` 里的哨兵 port，全量验证用手动 dispatch；改 consumer 脚本时哨兵不重建，测试的是 npm 上已发布的包。CI 通过 `CONSUMER_REQUIRE_ALL=true` 强制功能测试覆盖，缺失文件直接阻断门禁。

`test.mjs` 用于验证真实 API、CLI、加载和工程行为。已配置的 primary port 继续在 Windows x64、Linux x64/arm64、macOS arm64 和 OpenHarmony arm64 上运行。普通 OS 比较 baseline 与 overrides，OpenHarmony 验证 overrides。槽位使用同配方 artifact，不另开独立 port job。通用安装与功能测试互为补充，任一通过都不能替代另一方。
