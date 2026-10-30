# 用 GitHub App 创建非草稿 bump PR

默认 bump 工作流使用仓库 `GITHUB_TOKEN`。GitHub 为防止递归触发，不允许该 token 创建的 PR 自动触发新的 `pull_request` 工作流，因此默认先创建草稿，维护者标记 Ready for review 后再检查。

使用前必须在 **Settings → Actions → General → Workflow permissions** 开启 **Allow GitHub Actions to create and approve pull requests**，否则 `gh pr create` 会被 GitHub 拒绝。bump 工作流自身只声明 Contents 和 Pull requests 写权限，不需要 npm 发布凭据，也不需要把默认 Workflow permissions 改为 Read and write。

如果希望机器人像 BrewTestBot 一样直接创建普通 PR并自动运行 CI，需要一次性配置专用 GitHub App。仓库 token 无法代替你完成 App 注册、安装和私钥生成。

## 1. 创建 App

打开账户或组织的 **Settings → Developer settings → GitHub Apps → New GitHub App**：

- Name：`ohos-npm-ports-bump`
- Homepage：`https://github.com/hqzing/ohos-npm-ports`
- Webhook：取消 **Active**
- Repository permissions：
  - **Contents: Read and write**：推送 bump 分支
  - **Pull requests: Read and write**：创建和更新 PR
  - Metadata 只读权限自动带上
- **Workflows 不需要授权**：bump PR 只修改 `ports/**`
- 其他权限保持无权限

如果仓库以后迁到组织，建议在目标组织下创建或重新安装 App。

## 2. 只安装到目标仓库

点击 **Install App**，选择 **Only select repositories**，只安装到 `ohos-npm-ports`。不要授予全仓库访问权限。

## 3. 添加 Actions secrets

在 App 页面记录 **App ID**（不是 OAuth Client ID），点击 **Generate a private key** 下载 PEM。

进入仓库 **Settings → Secrets and variables → Actions**，添加：

- `BUMP_APP_ID`：App ID
- `BUMP_APP_PRIVATE_KEY`：完整 PEM，包括 BEGIN/END 和所有换行

不需要 Installation ID，也不要把私钥写入仓库或聊天记录。

## 4. 修改 bump 工作流

在 checkout 之前生成短期 App token，并用它 checkout、推送和调用 gh：

```yaml
- uses: actions/create-github-app-token@v2
  id: app-token
  with:
    app-id: ${{ secrets.BUMP_APP_ID }}
    private-key: ${{ secrets.BUMP_APP_PRIVATE_KEY }}
    owner: ${{ github.repository_owner }}
    repositories: ${{ github.event.repository.name }}
    permission-contents: write
    permission-pull-requests: write

- uses: actions/checkout@v7
  with:
    fetch-depth: 0
    token: ${{ steps.app-token.outputs.token }}

- uses: actions/setup-node@v7
  with:
    node-version: '24'

- name: Bump one port and create its ordinary PR unless one is already open
  env:
    GH_TOKEN: ${{ steps.app-token.outputs.token }}
  run: cli/npm-ports bump-pr "${{ matrix.port }}" --no-draft
```

这些步骤替换 bump job 中原来的 checkout、setup-node 和默认 `bump-pr` 步骤。矩阵中每个 job 都生成自己的短期 token，不要把 token 写入 job output。

## 5. 验证与回退

先手动 dispatch 一个有上游更新的 port，确认：

1. PR 不是草稿；
2. 创建后 `pull_request` 工作流自动开始；
3. PR 只包含该 port 的提交；
4. 工作流没有执行 npm publish。

验证完成前不要删除现有草稿机制。需要回退时，恢复原 checkout/token 步骤并去掉 `--no-draft` 即可。

App token 默认短期有效，且只能访问选定仓库。bump 工作流只通过 schedule 和维护者 dispatch 运行，不向普通 PR 暴露 App 私钥。
