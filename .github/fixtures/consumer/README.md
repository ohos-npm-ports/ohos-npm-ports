# 通用预发布 consumer 验证

## 分工

- `ports/<port>/<version>/test.js`：原始包映射、功能断言及工程场景。新增 port 测试不需要修改 runner 的包名清单。
- `.github/scripts/consumer-plan.mjs`：自动发现测试、选择变化的 port、展开配套构建依赖。CI 基础设施变化时验证全部已接入测试的 port。
- `.github/scripts/run-port-consumer.mjs`：artifact 校验、临时 Verdaccio、真实 npm alias overrides、安装/`npm ci`、执行 test.js 和 baseline 结果对比。没有针对 Next、Lightning CSS 等包的特殊分支。
- `projects/node/`：默认最小 npm 工程，不安装前端框架、不自动 build/start。`projects/react-assets/` 仅是可选 React/Webpack 样例。Next 各版本共用 `projects/next-react/`，通过 `@test-project: next-react` 选择。

## test.js 协议

```js
// @test-package: @upstream/package
// @test-project: react-assets
// @test-prerequisite: ports/companion-openharmony-arm64/1.2.3
import assert from 'node:assert/strict';
import fs from 'node:fs';
const pkg = await import('@upstream/package');
// 调用实际功能并断言，不能仅检查 import 成功。
assert.equal(pkg.actualFunction(), 'expected');
fs.writeFileSync(process.env.PORT_TEST_REPORT, JSON.stringify({
  result: { actualFunction: true },
  assets: []
}));
```

`@test-package` 必填，包含完整上游 scope。上游版本默认是 port 目录版本，可用 `@test-upstream-version` 覆盖；发布包名默认 `@ohos-npm-ports/<port目录名>`，可用 `@test-port-package` 覆盖。`@test-project` 默认 `node`。要使用可选前端样例须显式写 `@test-project: react-assets`；专属工程可通过 `@test-fixture: test-fixture` 指向该 port 内的目录，目录须包含 package.json。可重复的 `@test-prerequisite` 用于配套槽位包或其他 port；配套目录有 `test.js` 时也会进入该消费工程测试，没有时仅作为待发布的支持产物。

测试被复制到消费工程，默认以 ESM（.mjs）执行；仅显式声明 `@test-format: cjs` 时以 .cjs 执行，cwd 是工程根目录；用上游原名 require。`PORT_TEST_MODE` 为 `baseline` 或 `overrides`。`PORT_TEST_REPORT` 是必须写入的 JSON 报告路径。`result` 放跨模式可比较的功能结果；`assets` 放工程生成并要通过 HTTP 验证的资源，如 `{path:'/image.png',magic:'89504e470d0a1a0a'}` 或 `{path:'/style.css',includes:'.app{'}`。生成资源放到工程 `public/` 下。

如确实只支持部分平台，必须同时声明 `@test-platforms: openharmony`（逗号分隔）和 `@test-platform-reason: ...`；这些字段只记录适用范围，不会跳过矩阵 job；不支持 primary port 的 OS 会直接失败。仅目标平台可用的槽位包应作为父包的 prerequisite，而不是独立 primary 测试。普通 wrapper 应默认覆盖 Windows、Linux、macOS、OpenHarmony，不以静默跳过来制造通过。

## 全量接入与配套测试

port 逐个接入：有 test.js 的 primary 版本各自形成五 OS 矩阵，support 槽位由父包带测；缺 test.js 的版本在覆盖报告中为 warning，设置 `CONSUMER_REQUIRE_ALL=true` 后改为失败。此清单仅是配置覆盖；是否通过必须查看本轮各 OS job，不能沿用旧提交的绿色结果。

`@test-role` 默认 primary，support 只在依赖它的父包 job 中执行，不成为根依赖。`@test-timeout` 单位为秒，默认 600，上限 1800。`@test-browser: chromium` 声明需要临时浏览器服务。prerequisites 引入配套构建产物与 alias overrides，但不重复执行其他 primary 的完整功能测试；这些主包各有自己的五 OS 门禁。

`PORT_TEST_HELPER` 是可选 test-tools.mjs 的文件 URL，提供 packageRoot、bin、command、cli、write、report、bunScript。cli 能执行 Node 入口或原生 ELF/Windows 二进制；专项功能仍放在每个 port 的 test.js。Bun 测试通过 prerequisite 使用本轮 bun 产物。测试缺报告、缺运行时或超时均失败。

浏览器测试的 `PORT_TEST_BROWSER_ENDPOINT` 指向临时 Chromium CDP 服务。普通 OS 服务绑定 loopback；OpenHarmony consumer 在 ci-runner Docker 容器中执行，连接宿主 Docker bridge 上的浏览器代理，不开放公网端口。这里验证 OHOS 上的包及协议操作，不验证 OHOS 本地浏览器启动。

## 真实 overrides 和跨 OS 产物

每个 case 使用打包后的最小 `consumer-deps` 依赖包，正常声明上游包名与精确上游版本。根工程只通过 `overrides` 将传递依赖替换为 `npm:@ohos-npm-ports/<port>@<本次构建版本>`，并验证安装后的名称、版本、锁文件下载 URL 和 integrity。没有把 `file:` tarball 当作 override 的替代方案。

npm 不允许将根工程的直接依赖用不同 spec 的 override 替换（会报 `EOVERRIDE`）。直接依赖这些包的真实工程应修改 dependency 本身为 alias；本 harness 验证的是合法的传递依赖 overrides 路径。

构建 job 将本次临时 registry 中的精确 tarball 导出为 Actions artifact，携带来源 workflow commit SHA、port 目录、包名、版本与 SHA-512 integrity。各 OS job 下载 artifact，在各自的 loopback Verdaccio 重新发布同一批 tarball；不会跨 job 暴露 registry，不上传凭据、storage 或 `node_modules`。本次构建包禁用 npmjs 代理，其余依赖走 npmjs uplink。

Windows x64、Linux ARM64、Linux x86_64、macOS ARM64 分别运行原始 baseline 与 overrides 工程，比较功能结果；OpenHarmony ARM64 在 ci-runner 中运行 overrides 工程，因为上游原始 native bindings 通常不支持该平台。基于当前 OS 生成自己的 lockfile，再执行 `npm ci`；不共享不同 OS 的 lockfile。

Linux x86 指 x86_64，不包含 ia32。HTTP 检查覆盖生产页面、JS/CSS/图片资源，不包含浏览器 hydration、真机签名/沙箱或完整业务负载。


## 单 port × 五 OS 门禁

每个 consumer job 只能有一个 primary port（CONSUMER_PORT），仅允许带入它声明的 prerequisites。每个 primary 版本对应 5 个独立 consumer job（四个 OS job 加 OpenHarmony job）；任一 OS 失败，该版本不能算验证通过，整轮 CI 也不能成功。不会将不同 port 混在一个 job 中，再用整体成功推断某个包通过。

runner 不调用前端 build/start，也不读取 scenario.json。test.js 自己决定检查内容；默认 Node 工程可执行 API、CLI、数据库等测试。报告的 result 必填，assets 仅是可选的前端检查数据。

当前需要前端集成验证的 test.js 显式选择 react-assets，并在完成自己的 API 断言后调用：

```js
if (process.env.PORT_TEST_PRIMARY === 'true') {
  await (await import(process.env.PORT_TEST_FRONTEND_HELPER)).verifyFrontend(report);
}
```

该可选共享工具负责 build/start/HTTP/资源检查，只有 test.js 调用才执行。prerequisite 测试会收到 PORT_TEST_PRIMARY=false，避免辅助包替主包决定工程流程。PORT_TEST_NPM_CLI 指向该 job 的 npm CLI JS 文件，可用于跨平台执行 npm 命令（用 process.execPath 启动，避免依赖 npm.cmd 的 shell 行为）。

OpenHarmony consumer 使用 ci-runner 镜像自带的 NDK 库目录；该目录加入运行时动态库搜索路径。验证结果不证明真实设备上的系统服务行为，尤其不将 CI 库提供的时区结果作为系统服务验收。

`@test-setup: true` 声明安装前准备阶段：runner 在 npm install/npm ci 前执行同一 test.js，传入 PORT_TEST_PHASE=setup；正常功能阶段传入 test。setup 不要求报告，但异常和超时仍失败。系统依赖及准备逻辑留在 port 内，不在 runner 中写包名分支。

## CI 基础设施约定

- `infrastructure.json` 是「改动后需全量验证」的唯一清单；`ci.yml` 的 `paths` 必须与之一致（`consumer-plan.test.mjs` 校验）。`*.md` 不触发全量。
- `.github/scripts/tool-versions.json` 固定 npm、Verdaccio、playwright-core 的精确版本；升级需单独提交。npm 安装带 `fetch-retries` 并对工具安装重试 3 次。
- 每个 OS 一个独立 consumer job（`consumer-tests-<os>-<arch>`），避免单个 matrix 超过 GitHub 的 256 项上限；共用步骤在 `.github/actions/consumer-job`。
- 失败时 runner 写 `FAIL ...` 到 step summary，并把 Verdaccio 日志、npm `_logs`、`.port-tests` 保存到 `.consumer-logs/`，由 `consumer-logs-*` artifact 上传（保留 3 天）。
- workflow 带 `concurrency`（PR 内新推送取消旧运行，main 不取消）和最小 `permissions`。
