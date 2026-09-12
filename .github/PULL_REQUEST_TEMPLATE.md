<!-- 不要勾选你实际没有做过的项。 -->

- [ ] Commit message 符合仓库规范（`docs/zh-CN/contributor/contributing.md` 的 「Commit 规范」一节，CI 的 `lint-commits` 会自动检查）
- [ ] 已在 `ci-runner` 容器内跑通 `build.sh`（而非在宿主机上直接跑）
- [ ] `package.json` 的 `name` 是 `@ohos-npm-ports/<port>`、`version` 是 `<上游版本>-<修订号>`
- [ ] 涉及 `.node`/`.so` 的改动：产物已签名（`readelf -S <file> | grep .codesign` 能看到）
- [ ] `patchs/` 里的每个 patch 都被 `build.sh` 实际应用（没有孤立补丁文件）
- [ ] 没有改动原作者信息或开源许可证声明
- [ ] 这个改动没有破坏该包在其他平台（darwin/linux-glibc/win32 等）上的正常使用

**这个 PR 是什么类型**（可多选）：

- [ ] 新增 port
- [ ] 已有 port 升级上游版本
- [ ] 已有 port 的修订号迭代（补丁修复，上游版本不变）
- [ ] 文档 / CI / 其他非 port 改动

**简述改了什么、为什么**：

<!-- 新增/升级 port 请附上游 changelog 或 release 链接 -->

-----

- [ ] 这个 PR 的内容由 AI 生成或辅助完成。*如果是，请在下面说明用在了哪一步、你手动验证过哪些部分。*
