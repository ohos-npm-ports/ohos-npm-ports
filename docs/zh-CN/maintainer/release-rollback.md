# 发布出问题了怎么办

## 原则：禁止 unpublish，永远往前修

npm 官方明确不鼓励 `npm unpublish`——一旦有其他项目在这次发布之后安装过、缓存过、或者把它锁进了 lockfile，`unpublish` 会让那些项目的构建直接断掉，而且没有任何预警。**本仓库不做 unpublish**，出问题一律用下面两种“往前修”的手段：

### 1. `npm deprecate` 标记这个版本，发新修订号修复

```sh
npm deprecate @ohos-npm-ports/<port>@<坏版本> "说明坏在哪、该升到哪个版本"
```

`deprecate` 不会阻止已经锁定这个版本的项目继续安装它（避免制造新的破坏），但会在 `npm install` 时给出警告，引导用户升级。然后修复对应 port 的补丁或构建，并执行 `npm-ports revision <port>` 将修订号 +1；打包器会统一生成 `<上游版本>-<N+1>` 及同步槽位引用。修复后的版本正常合并、正常发布。

### 2. dist-tag 回退（如果坏版本已经是 `latest`）

```sh
npm dist-tag add @ohos-npm-ports/<port>@<上一个好版本> latest
```

把 `latest` 指回上一个好版本，防止后续新装的用户默认拿到坏版本；已经 `npm install` 过坏版本、锁了 lockfile 的用户不受这一步影响（这也是为什么第一步的 `deprecate` 警告仍然需要）。

## 发布中断或重复：不用手工补发

CI 按 npm 上有没有这个版本来决定发不发布，而不是看这次提交改了什么：

- 每次 main push，凡是进入构建矩阵的 port，都会用 `npm view @ohos-npm-ports/<port>@<版本>` 检查主包。**只有返回 404 的才发布**；网络、鉴权等其他错误会直接让检查失败，不会被当成“没发布”。
- 发布时 slot 包先发、主包最后发，所以主包能在 npm 上查到，就说明该 port 的 slot 已经发完。主包没发出去，`latest` 也不会指向缺 slot 的版本。
- `npm-ports publish --skip-existing` 对每个包再查一次：版本已存在且 integrity 与待发 tarball 一致就跳过（重跑幂等，也覆盖“检查和发布之间被别的 run 抢先发了”）；**版本已存在但 integrity 不同则报错**，说明同一个版本号下已有别的内容，必须 bump revision，不能覆盖。

所以遇到下面几种情况，都不需要手工发布：

| 情况 | 处理 |
|---|---|
| 发布 job 中途失败或被取消 | 重跑该 run；或者下一次涉及该 port 的 main push 会自动补发缺的版本 |
| 只改了 CI、test.js、文档，或批量改目录名 | 版本没变，npm 上已有，不会尝试发布 |
| 改了 patch 或 NPMBUILD 但忘了 bump revision | 合入后不会发布。PR 的 port-lint 会给出 warning，用 `npm-ports revision <port>` 补上 |
| `already published with different content` | 同一版本号已有不同内容。不要覆盖：bump revision 后重新发布 |

## 什么时候该走这个流程

- 发布后才发现 `require()` 直接崩溃、或者签名缺失导致真机装不上。
- 发布的产物文件不完整（比如平台专属子包的 `optionalDependencies` 版本号和主包对不上，导致装不到正确的二进制槽位）。
- 误操作发布了不该发布的中间产物（调试用的临时版本号等）。

## 事后

- 在对应 port 的下一次修订（或下一次上游版本升级）里，把导致这次问题的根因写进 commit message 或 patch 注释，避免同类问题重复发生。
- 如果问题的根因是 CI 门禁本该拦住但没拦住的（比如自动检查漏掉这个场景），补一条对应的检查规则，参照 [../maintainer/ci-pipeline.md](ci-pipeline.md) 里“先跑一遍存量确认零误报再定为阻断”的引入方式。
