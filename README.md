# ohos-npm-ports

## 项目介绍

ohos-npm-ports 项目，是一个把 npm 三方库移植到 OpenHarmony 平台的项目。

ports 这个词一语双关，既表示移植软件，也表示本项目采用 ports 模式维护软件包（只存储构建脚本，不存储完整源码） 。

## 本项目解决什么问题

当前 Node.js 运行时已经支持 OpenHarmony 平台（以下简称鸿蒙），详见[官方文档](https://github.com/nodejs/node/blob/main/BUILDING.md)。

然而，Node.js 运行时支持鸿蒙，并不意味着 npm 包也一定支持鸿蒙。因为有一部分 npm 包并不是跨平台的，尤其是使用了 addon 技术的 npm 包最为典型。这些 npm 包想要在鸿蒙上正常使用，是需要做移植/适配工作的。

对于需要鸿蒙适配的 npm 包，最佳的处理方式是直接往官方社区提 PR，让官方社区支持鸿蒙，不要额外 fork 版本出来维护。这样可以既让维护成本最小化，也能让用户得到最佳的使用体验。

这个项目主要是用于处理那些短时间无法合入官方社区、但在业界又有广泛使用诉求的包。

项目维护者在 npm 中心仓上面注册了一个 scope 叫做 `@ohos-npm-ports`，其他开发者可以把一些已经做了鸿蒙适配、但又没能合入到官方社区的 npm 包发布到这个 scope 下面，用户可以通过新的包名在鸿蒙设备上下载、使用这些包。

## 已收录的包

| 原始包名   | 鸿蒙适配后的包名           | 最新版本 |
| ---------- | -------------------------- | -------- |
| bufferutil | @ohos-npm-ports/bufferutil | 4.0.9-6  |
| sqlite3    | @ohos-npm-ports/sqlite3    | 5.1.7-7  |

## 使用方法

以 `sqlite3` 这个包为例，如果你的项目直接依赖了它，请使用别名的方式将其替换成 `@ohos-npm-ports/sqlite3`

```json
{
  "dependencies": {
    "sqlite3": "npm:@ohos-npm-ports/sqlite3"
  }
}
```

如果你的项目间接依赖了它，请使用 overrides 字段去进行依赖覆盖，将其替换成 `@ohos-npm-ports/sqlite3`

```json
{
  "dependencies": {
    "sqlite-tool": "^0.1.0" // sqlite-tool 依赖 sqlite3，因此这个项目会间接依赖 sqlite3
  },
  "overrides": {
    "sqlite3": "npm:@ohos-npm-ports/sqlite3"
  }
}
```

PS：如果需要指定版本号，可以写成这种形式：npm:@ohos-npm-ports/sqlite3@5.1.7-7

## 兼容性

本项目主要针对社区版 OpenHarmony 构建 npm 包，但一般情况下构建出来的 npm 包也可运行在 OpenHarmoy 的商用发行版——HarmonyOS 中。

## 贡献指南

如果你想要往这里面录入一个 npm 包，需要经过以下这些步骤

**1\. 准备 Docker 环境**

本项目的 addon 全部采用原生编译的方式来进行构建，基于 [DockerHarmony](https://github.com/hqzing/dockerharmony) 来做原生编译的流水线（详情请看 `.github/workflows/ci.yml` 文件）。为了确保流水线能顺利出包，你需要使用相同的环境进行本地构建和测试。

因此你需要准备一个能够运行 [DockerHarmony](https://github.com/hqzing/dockerharmony) 的环境。环境以 arm 服务器为佳，如果没有 arm 服务器，也可使用 Mac 电脑，或在 x86_64 设备上通过 QEMU 来运行这个容器（但要注意此种用法性能较差）。

> 注意：构建过程中通常会需要去 GitHub 下载源码，需要留意网络连通性的问题。有条件的话建议直接开通香港或国外的 arm 服务器来进行使用。

**2\. Fork 仓库**

Fork 本仓库，生成自己的个人仓，并在个人仓的 Actions 菜单启用它的工作流。

**3\. 编写补丁和脚本**

参考现有的包，制作鸿蒙适配补丁，编写构建脚本（build.sh）和发布脚本（publish.sh）。

注意事项：

1. 根目录的 setup-tools.sh 和 setup-env.sh 可以支撑你完成常规的构建环境的配置。一般情况下，你只需在你自己的 build.sh 和 publish.sh 里面 source 这两个脚本就能满足 addon 构建需求。然而，在一些深度的使用场景下它可能无法满足你的需求。此时你也可以不去 source 它们，可以自己编写环境配置命令。
2. 适配的过程要注意兼容性，请勿破坏这个包在其他 OS 上的行为。不能适配后变得只能在鸿蒙上使用、无法在其他 OS 上使用，这样的包无法支撑实际生产活动。
3. OpenHarmony 的商用发行版 HarmonyOS 会对 ELF 文件做代码签名校验。为了让产物也支持 HarmonyOS，请确保自己发布的 .node 文件带有代码签名。如果构建时使用的是 Harmonybrew 下载的 ohos-sdk，它构建出的产物会自动带有代码签名（详情请参见 [这篇文档](https://atomgit.com/Harmonybrew/docs/blob/main/zh-CN/user/featured-packages.md)）。如果使用的是来自其他地方的构建工具，则需要自行处理代码签名。
4. 发布软件包的时候，建议使用 `x.y.z-1`、`x.y.z_1` 等修订版本号，以便在不改变 semver 版本的情况下进行补丁版本迭代。
5. 尊重他人知识产权，改包的时候请勿改动原有的作者和开源许可证信息。

**4\. 本地构建和验证**

启动一个 [鸿蒙容器](https://github.com/hqzing/dockerharmony)，然后将你改的代码放到容器中进行构建，把你的脚本调通。

以 sqlite3 这个库为例，构建流程如下

```sh
docker pull ghcr.io/hqzing/dockerharmony:latest
docker run -itd --name=ohos ghcr.io/hqzing/dockerharmony:latest

git clone https://github.com/ohos-npm-ports/ohos-npm-ports.git

docker cp ohos-npm-ports ohos:/root
docker exec -it ohos sh

cd /root/ohos-npm-ports/ports/sqlite3/5.1.7
./build.sh
```

构建之后还要验证，以确保自己制作的 npm 包是可用的。要确保用户能够正常 npm install 下载它，能正常被 require/import。

建议使用 [Verdaccio](https://github.com/verdaccio/verdaccio) 之类的工具搭建 npm 私仓，对发布、下载、使用流程进行验证。你也可以使用其他方式进行验证，确保验证到位即可。

**5\. 提交到个人仓**

提交到个人仓，观察个人仓里面的工作流是否能正常触发、正常执行 build.sh。

只要 build.sh 能运行正常就行，另一个 publish.sh 脚本因权限问题一定会产生发布失败的报错，这是预期之内的结果。

**6\. 提交 PR**

将 PR 提到本仓库，待合入后流水线会自动构建发包。

## 项目治理

注意事项：

- 本仓库中的包主要供临时使用，当一个包正式被官方接纳后，维护者会将这个包从本仓库中删去，不再接受贡献。

若有问题咨询求助，可联系以下维护者：

- [hqzing](https://github.com/hqzing)：hqzing@outlook.com
