# 发布出问题了怎么办

## 原则：禁止 unpublish，永远往前修

npm 官方明确不鼓励 `npm unpublish`——一旦有其他项目在这次发布之后安装过、缓存过、或者把它锁进了 lockfile，`unpublish` 会让那些项目的构建直接断掉，而且断得没有任何预警。**本仓库不做 unpublish**，出问题一律用下面两种「往前修」的手段：

### 1. `npm deprecate` 标记这个版本，发新修订号修复

```sh
npm deprecate @ohos-npm-ports/<port>@<坏版本> "说明坏在哪、该升到哪个版本"
```

`deprecate` 不会阻止已经锁定这个版本的项目继续安装它（避免制造新的破坏），但会在 `npm install` 时给出警告，引导用户升级。然后正常走一次 port 修订号 +1 的发布（改 `patchs/` 或 `build.sh`，`package.json` 的 `version` 从 `<上游版本>-<N>` 改成 `<上游版本>-<N+1>`），修复后的版本正常合并、正常发布。

### 2. dist-tag 回退（如果坏版本已经是 `latest`）

```sh
npm dist-tag add @ohos-npm-ports/<port>@<上一个好版本> latest
```

把 `latest` 指回上一个好版本，防止后续新装的用户默认拿到坏版本；已经 `npm install` 过坏版本、锁了 lockfile 的用户不受这一步影响（这也是为什么第一步的 `deprecate` 警告仍然需要）。

## 什么时候该走这个流程

- 发布后才发现 `require()` 直接崩溃、或者签名缺失导致真机装不上。
- 发布的产物文件不完整（比如平台专属子包的 `optionalDependencies` 版本号和主包对不上，导致装不到正确的二进制槽位）。
- 误操作发布了不该发布的中间产物（调试用的临时版本号等）。

## 事后

- 在对应 port 的下一次修订（或下一次上游版本升级）里，把导致这次问题的根因写进 commit message 或 patch 注释，避免同类问题重复发生。
- 如果问题的根因是 CI 门禁本该拦住但没拦住的（比如 smoke 检查漏了这个场景），补一条对应的检查规则，参照 [../maintainer/ci-pipeline.md](ci-pipeline.md) 里「先跑一遍存量确认零误报再定为阻断」的引入方式。
