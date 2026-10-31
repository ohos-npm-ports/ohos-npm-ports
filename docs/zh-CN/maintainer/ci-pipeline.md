# CI 流水线

## 1. 触发与整体形状

| workflow | 触发 | 职责 |
|---|---|---|
| `pr-commit-count.yml` | 目标为 main 的 PR（创建及后续更新） | 检查每个 PR 只能有一个 commit。源分支后续推送会重新检查 |
| `port-lint.yml` | ports 变更的 PR | NPMBUILD、辅助脚本、patch 和 commit message 检查 |
| `ci.yml` | ports/基础设施变更、main push、手动 | 自动构建（输入没变的 port 取 npm 上已发布的 tarball）、临时 Verdaccio、artifact、五平台 consumer。`conclusion` 全绿后，白名单 main 由独立的 `publish` job 正式发布 |
| `bump.yml` | 每日调度、手动 | 逐个 port 执行 `npm-ports bump-pr`，无开放 PR 时创建独立 PR |

port 目录为 `ports/<首字母>/<name>` 或 `ports/<首字母>/<name>@<版本线>`。变更检测按这一级建立矩阵。手动 dispatch 默认构建全部 port（要强制重建时用它），artifact replay 仍按 sourceSha 和输入不变性复用。

## 2. 先验证，批准后发布

普通人工 PR 在基础检查通过后自动执行完整构建、临时 Verdaccio 和五平台 consumer，不需要管理员先批准构建。机器人 PR 默认先为草稿，Ready for review 后运行同一套检查。管理员 review 和合并决定发布。只有白名单组织仓库的 main push，并且整轮 `conclusion` 全绿，才会进入 `publish` job。

如果按 [GitHub App 指南](github-app.md) 配置专用 App，可将 bump PR 改为普通 PR，创建后直接触发检查，不再需要 Ready for review。

## 3. 首次外部贡献者防护

`FIRST_TIMER` 或 `FIRST_TIME_CONTRIBUTOR` 的非机器人 PR，在完整构建前经过 `external-ci` Environment 的 required reviewers 审批：

- 基础 lint 先运行，帮助管理员审查变更。
- 审批 job 不带矩阵、不 checkout PR，每个 SHA 只审批一次。
- 普通贡献者、维护者和来源仓库与目标仓库相同的机器人 PR 不经过此额外审批。豁免只依据 `pull_request.head.repo.full_name`，不依据可由贡献者任意命名的分支。
- main 合并后不再重复审批。

该门只防止首次外部贡献者滥用高成本构建资源，不改变“完整检查先于发布审核”的主流程。

## 4. port-lint 与变更检测

`npm-ports lint` 检查 NPMBUILD 可解析、版本和 tag 合法、首字母目录与发布短名冲突、产物路径安全，同时检查 Bash 语法、孤立 patch、遗留 publish.sh、旧元数据别名、版本字面量、重复全局声明、重复 SHA-256、readelf、签名逻辑、连续空行和构建内直接发布。`lint-commits` 只检查改动 `ports/**` 的 commit message。它与适用于所有 PR 的单 commit 门禁是两条独立规则。

## 5. 构建、私仓与 artifact

```sh
npm-ports check "${{ matrix.dir }}"
```

随后 `validate-local-publish.mjs` 执行 `pack --no-build`。打包器先注入 revision，再使用 `/storage/Users/currentUser/.harmonybrew/opt/ohos-selfsign/bin/selfsign --force` 统一为发布目录中的 AArch64 ELF 签名。随后生成 tarball，启动临时 Verdaccio，真实发布并安装全部主包和槽位包。上传的是私仓实际导出且通过 integrity 校验的 tarball，不另做 bottle。

### 哪些 port 构建，哪些直接取 npm 上的包

`detect-changes` 先决定本轮哪些 port 需要产出 tarball（`matrix`：改动的 port 和它们的依赖者；只改基础设施时是 `sentinel-ports.json` 里的哨兵 port；main push 上再加上 npm 缺版本的 port，保证发布自愈），再把它们分成两路：

- `build-matrix`：现场构建。条件是任意一条成立：port 目录（test.js 除外）有改动。`build-infrastructure.json` 里的文件有改动（此时矩阵里只有哨兵和改动的 port）。这个版本在 npm 上还没有。手动 dispatch（全部 port）。
- `fetch-matrix`：其余 port。`fetch` job 用 `fetch-published.mjs` 下载已发布的主包和槽位包，核对 registry 的 integrity，写出和构建产物同格式的 manifest（`origin: "npm"`），再以同样的 `port-<name>` artifact 名上传，consumer 不需要区分来源。

`infrastructure.json` 是会触发 CI 的全部文件，`build-infrastructure.json` 是其中会改变构建产物的子集（`ci.yml` 的构建步骤、`cli/` 里的构建代码、`validate-local-publish.mjs`、`tool-versions.json` 等）。只改基础设施时不再测试全部 port，只测 `sentinel-ports.json` 里的哨兵 port（需要是带 primary `test.js` 的轻量 port）：改的是构建基础设施，哨兵重新构建；改的是 consumer 脚本等测试基础设施，哨兵取 npm 上已发布的包。需要全量验证时手动 dispatch。

注意两点：

- 槽位包只存在于构建产物里，所以从已发布的主包依赖里反推（引用了本 port 同一版本的 `@ohos-npm-ports/*` 包），并要求个数等于 NPMBUILD 的 `packages`，对不上就失败，不会漏测。
- `ci-runner:latest` 镜像和 Homebrew 配方索引的变化检测不到。镜像或工具链更新后，用手动 dispatch 做一次全量构建确认。

fetch 得到的包不会被发布：它们的版本已经在 npm 上，不在发布列表里，`npm-ports publish` 也会拒绝 `origin: "npm"` 的 manifest。

main push 上的发布列表按 npm 现状判定：构建矩阵里主包版本在 npm 上返回 404 的 port 才发布，PR 和手动触发不发布。`detect-changes` 同时输出 `publish-order`，被依赖的 port 排在前面。

发布由独立的 `publish` job 完成，不在构建 job 里：

- 它依赖 `conclusion`，所以任何一个构建或 consumer 失败，本轮都不发布。flaky 的失败用 “Re-run failed jobs” 重跑。真失败修复后再 push，发布列表按 npm 现状判定，漏发的版本会自动补上。
- 它下载本轮上传的 `port-*` artifact，发布的是验证过的同一批 tarball，不重新构建。`--expect-sha` 要求 manifest 的 `sourceSha` 等于当前 commit。
- `NPM_TOKEN` 只在这个 job 里，先写入文件。执行 NPMBUILD 的发布步骤环境里没有它。
- 依赖先发，任何一个 port 失败就停止。每个 port 内 slot 先发、主包最后发。发布命令带 `--skip-existing`：已存在且内容一致的版本跳过，内容不同则报错。dist-tag 已指向更新的版本时，旧版本以 `stale` tag 发布，不会把 `latest` 拨回去。详见 [发布出问题了怎么办](release-rollback.md)。



manifest 记录 `sourceSha`、`portDir` 和每个包的名称、版本、文件名与 SHA-512。test.js 单独变化不触发重新发布。

## 6. 五平台 consumer 与 conclusion

`artifacts` job 等 `build` 和 `fetch` 都结束，并且首次外部贡献者审批通过之后，才放行 consumer。个别 port 构建失败时，其余 consumer 照常运行。

通用安装验证不再要求 `test.js`：`consumer-install` 在 Windows x64、Linux x64/arm64 和 macOS arm64 上形成矩阵，`consumer-install-openharmony` 在 ci-runner 中运行。它们根据构建矩阵自动选择 port，下载本轮 artifact，在各平台的临时 Verdaccio 中发布并安装主包，按 os/cpu 检查槽位、所有应安装的包、版本和 bin，再执行 npm ci。全量 dispatch 覆盖所有 port，普通变更覆盖受影响 port，artifact replay 同样启用，不需要任何 port 专属入口。

`test.js` 只承担额外的功能验证。每个 primary port 继续在五个平台执行真实工程或 API 测试，普通 OS 比较 baseline 和 overrides，OpenHarmony 验证 overrides。合并槽位与主包来自同一 manifest，不把 `test.js` 缺失解释为未做安装验证。

`conclusion` 同时汇总变更检测、首次外部审批、构建、通用安装和原有功能测试结果，任一必需结果失败都会使总检查失败，供分支保护使用。`publish` 排在 `conclusion` 之后，不属于它的汇总范围，PR 上不会运行。

## 7. bump PR

bump 矩阵按 port 隔离失败。`bump-pr` 一次处理一个 port，要求干净工作区及 HEAD 与 origin/main 一致。它先枚举目标分支的开放 PR 及其变更文件。只要已有 PR 修改同一 port，无论目标版本新旧都跳过，不更新、不覆盖。没有冲突时创建包含目标版本的新分支并普通推送，禁止 force push。没有更新时不建分支。工作流不包含第三方 PR Action，也不执行 npm publish。

bump 只根据 `upstream` 查询 npm registry。主 port 跟随指定 dist-tag，`@` port 只选择版本线内最高 semver。写入时精确修改 NPMBUILD 中的版本、revision、主 source/sha256 和引用 `${version}` 的 resource，重新计算对应摘要，不扫描或改写补丁，也不全局替换字符串。固定资源不随主版本误更新。npm 预览版本与源码没有可靠映射的 port 必须禁用自动 bump。自动更新不代表上游 patch 必然兼容，补丁仍需贡献者审查并经过真实构建。

## 8. 验证边界

容器构建和跨平台 consumer 不等同于真机部署证明。目标设备上的签名、沙箱和业务行为仍需单独验证。
