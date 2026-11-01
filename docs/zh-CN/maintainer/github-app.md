# 用 GitHub App 驱动自动升级

bump 和 AI 修复工作流使用 GitHub App 创建、更新 PR。GitHub 为防止递归触发，不允许仓库 `GITHUB_TOKEN` 创建或推送的 PR 自动触发新的 `pull_request` 工作流。App Token 没有这项限制，因此 bump PR 创建后就能运行 CI，AI 推送修复后也会重新运行完整检查。

使用前必须在 **Settings → Actions → General → Workflow permissions** 开启 **Allow GitHub Actions to create and approve pull requests**。工作流只声明 Contents 和 Pull requests 写权限，不需要 npm 发布凭据，也不需要把默认 Workflow permissions 改为 Read and write。

## 1. 创建 App

打开账户或组织的 **Settings → Developer settings → GitHub Apps → New GitHub App**：

- Name：`ohos-npm-ports-automation`
- Homepage：`https://github.com/ohos-npm-ports/ohos-npm-ports`
- Webhook：取消 **Active**
- Repository permissions：
  - **Contents: Read and write**：推送 bump 和修复分支
  - **Pull requests: Read and write**：创建和更新 PR
  - Metadata 只读权限自动带上
- **Workflows 不需要授权**：机器人只修改 `ports/**`
- 其他权限保持无权限

如果仓库迁移到组织，建议在目标组织下创建或重新安装 App。

## 2. 只安装到目标仓库

点击 **Install App**，选择 **Only select repositories**，只安装到 `ohos-npm-ports`。不要授予全仓库访问权限。

## 3. 添加 Actions secrets

在 App 页面记录 **App ID**（不是 OAuth Client ID），点击 **Generate a private key** 下载 PEM。

进入仓库 **Settings → Secrets and variables → Actions**，添加：

- `AUTOMATION_APP_ID`：App ID
- `AUTOMATION_APP_PRIVATE_KEY`：完整 PEM，包括 BEGIN/END 和所有换行
- `DEEPSEEK_API_KEY`：AI 修复使用的 DeepSeek API 密钥

不需要 Installation ID，也不要把私钥或 API 密钥写入仓库或聊天记录。

## 4. 工作流如何使用 App

`bump.yml` 的每个矩阵任务通过 `actions/create-github-app-token` 生成短期 App Token，用它 checkout、推送和创建普通 PR。命令为：

```sh
cli/npm-ports bump-pr "${{ matrix.port }}" --no-draft
```

`ai-bump.yml` 只在维护者添加 `request-ai-bump` 标签后运行。AI 容器只获得 `DEEPSEEK_API_KEY`，不会获得 App 私钥、App Token 或仓库凭据。独立构建验证通过后，宿主环境才生成 App Token，在全新克隆中应用修复补丁、amend 原提交并使用 force-with-lease 推送。

不要把 App Token 写入 job output，也不要传给执行 NPMBUILD 或 AI 命令的容器。

## 5. 验证

先手动 dispatch 一个有上游更新的 port，确认：

1. PR 不是草稿，创建后自动开始检查。
2. PR 只包含该 port 的一个提交。
3. 构建失败后添加 `request-ai-bump`，AI 修复 check 开始运行。
4. AI 修复通过独立构建后才推送，PR 仍只有一个提交，新 CI 自动开始。
5. 两个工作流都没有执行 npm publish。

AI 修复的 Checks 和评论用于判断执行结果，不使用额外的运行状态标签。需要重试时，重新添加 `request-ai-bump` 即可。
