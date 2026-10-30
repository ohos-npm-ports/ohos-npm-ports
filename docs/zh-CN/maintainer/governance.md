# 项目治理

## 定位：临时垫层，不是长期分发点

本仓库收录“暂时没能合入官方社区、但业界有实际使用诉求”的包。上游正式支持 OpenHarmony 并已发布后，维护者会将对应包从本仓库移除，不再接受新贡献，避免临时方案和上游行为漂移。

“已经上游化”指上游已有对应 OpenHarmony 平台支持并正式发布，而不是只有 PR 或 issue 承诺。

## 移除一个已上游化的包

1. 确认上游对应版本已经正式发布。
2. 从 README 的包清单删除对应条目。
3. `ports/<首字母>/<port>/` 及其 `@` 旧版本线可以保留一段时间供追溯，也可以直接删除，由维护者按情况决定。
4. 在移除 PR/commit 中注明上游版本和对应 PR/release 链接。

## 维护者职责范围

- 判定新包是否符合准入规则（见 [../contributor/contributing.md](../contributor/contributing.md)）。
- 合并前确认 port-lint 和 ci.yml 通过；CI 通过不等于批准合并，仍需检查适配范围和补丁质量。
- 发布完全交给 CI，合并后由 `npm-ports publish` 发布已验证 tarball，不需要手动 npm publish。

## 自动化边界

- **bump PR**：`bump.yml` 每日按配方检查上游并创建独立 PR，所有 PR 仍走完整 CI 和人工审查。
- **不做自动合并（automerge）**：合并会触发 npm 发布，爆炸半径值得一次人工点击确认。
- **不做发布回滚（unpublish）**：npm 官方不鼓励 unpublish，出问题走 `npm deprecate` + 新修订号修复，见 [release-rollback.md](release-rollback.md)。

社区贡献者可以人工提交版本升级，也可以使用 NPMBUILD bump 命令生成同样的变更；没有绕过 CI 的特殊通道。
