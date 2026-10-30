# CI 流水线

## 1. 触发与整体形状

| workflow | 触发 | 职责 |
|---|---|---|
| `port-lint.yml` | ports 变更的 PR | NPMBUILD、辅助脚本、patch 和 commit message 检查 |
| `ci.yml` | ports/基础设施变更、main push、手动 | 自动构建、临时 Verdaccio、artifact、五平台 consumer；白名单 main 额外正式发布 |
| `bump.yml` | 每日调度、手动 | 逐个 port 执行 `npm-ports bump-pr`，无开放 PR 时创建独立 PR |

port 目录为 `ports/<首字母>/<name>` 或 `ports/<首字母>/<name>@<版本线>`。变更检测按这一级建立矩阵。手动 dispatch 默认构建全部 port，artifact replay 仍按 sourceSha 和输入不变性复用。

## 2. 先验证，批准后发布

普通人工 PR 在基础检查通过后自动执行完整构建、临时 Verdaccio 和五平台 consumer，不需要管理员先批准构建。机器人 PR 默认先为草稿，Ready for review 后运行同一套检查。管理员 review 和合并决定发布；只有白名单组织仓库的 main push 才执行中心仓 publish。

如果按 [GitHub App 指南](github-app.md) 配置专用 App，可将 bump PR 改为普通 PR，创建后直接触发检查，不再需要 Ready for review。

## 3. 首次外部贡献者防护

`FIRST_TIMER` 或 `FIRST_TIME_CONTRIBUTOR` 的非机器人 PR，在完整构建前经过 `external-ci` Environment 的 required reviewers 审批：

- 基础 lint 先运行，帮助管理员审查变更。
- 审批 job 不带矩阵、不 checkout PR，每个 SHA 只审批一次。
- 普通贡献者、维护者和来源仓库与目标仓库相同的机器人 PR 不经过此额外审批；豁免只依据 `pull_request.head.repo.full_name`，不依据可由贡献者任意命名的分支。
- main 合并后不再重复审批。

该门只防止首次外部贡献者滥用高成本构建资源，不改变“完整检查先于发布审核”的主流程。

## 4. port-lint 与变更检测

`npm-ports lint` 检查 NPMBUILD 可解析、版本和 tag 合法、首字母目录与发布短名冲突、产物路径安全，同时检查 Bash 语法、孤立 patch、遗留 publish.sh、旧元数据别名、版本字面量、重复全局声明、重复 SHA-256、readelf、签名逻辑、连续空行和构建内直接发布。`lint-commits` 规则不变。

## 5. 构建、私仓与 artifact

```sh
npm-ports check "${{ matrix.dir }}"
```

随后 `validate-local-publish.sh` 执行 `pack --no-build`。打包器先注入 revision，再使用 `/storage/Users/currentUser/.harmonybrew/opt/ohos-selfsign/bin/selfsign --force` 统一为发布目录中的 AArch64 ELF 签名；随后生成 tarball，启动临时 Verdaccio，真实发布并安装全部主包和槽位包。上传的是私仓实际导出且通过 integrity 校验的 tarball，不另做 bottle。

manifest 记录 `sourceSha`、`portDir` 和每个包的名称、版本、文件名与 SHA-512。test.js 单独变化不触发重新发布。

## 6. 五平台 consumer 与 conclusion

通用安装验证不再要求 `test.js`：`consumer-install` 在 Windows x64、Linux x64/arm64 和 macOS arm64 上形成矩阵，`consumer-install-openharmony` 在 ci-runner 中运行。它们根据构建矩阵自动选择 port，下载本轮 artifact，在各平台的临时 Verdaccio 中发布并安装主包，按 os/cpu 检查槽位、所有应安装的包、版本和 bin，再执行 npm ci。全量 dispatch 覆盖所有 port，普通变更覆盖受影响 port，artifact replay 同样启用，不需要任何 port 专属入口。

`test.js` 只承担额外的功能验证。每个 primary port 继续在五个平台执行真实工程或 API 测试，普通 OS 比较 baseline 和 overrides，OpenHarmony 验证 overrides。合并槽位与主包来自同一 manifest，不把 `test.js` 缺失解释为未做安装验证。

`conclusion` 同时汇总变更检测、首次外部审批、构建、通用安装和原有功能测试结果，任一必需结果失败都会使总检查失败，供分支保护使用。

## 7. bump PR

bump 矩阵按 port 隔离失败。`bump-pr` 一次处理一个 port，要求干净工作区及 HEAD 与 origin/main 一致。它先枚举目标分支的开放 PR 及其变更文件；只要已有 PR 修改同一 port，无论目标版本新旧都跳过，不更新、不覆盖。没有冲突时创建包含目标版本的新分支并普通推送，禁止 force push；没有更新时不建分支。工作流不包含第三方 PR Action，也不执行 npm publish。

bump 只根据 `upstream` 查询 npm registry。主 port 跟随指定 dist-tag，`@` port 只选择版本线内最高 semver；写入时精确修改 NPMBUILD 中的版本、revision、主 source/sha256 和引用 `${version}` 的 resource，重新计算对应摘要，不扫描或改写补丁，也不全局替换字符串。固定资源不随主版本误更新；npm 预览版本与源码没有可靠映射的 port 必须禁用自动 bump。自动更新不代表上游 patch 必然兼容，补丁仍需贡献者审查并经过真实构建。

## 8. 验证边界

容器构建和跨平台 consumer 不等同于真机部署证明。目标设备上的签名、沙箱和业务行为仍需单独验证。
