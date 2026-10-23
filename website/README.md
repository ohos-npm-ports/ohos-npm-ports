# 包目录网站

Vue Vapor + Vite+ 静态站，保留原有响应式版型、深浅主题、搜索筛选和版本详情。不引入 Router、Pinia 或 UI 组件库。

## 开发与验证

需要 Node.js 24。已安装全局 Vite+ 时，在 `website/` 内执行：

```sh
vp install
vp run sync-data
vp dev
vp check
vp test
vp build
vp preview
```

没有全局 vp 时先安装 package.json 指定的 pnpm，执行 `pnpm install --frozen-lockfile`，之后使用同名 scripts（例如 `pnpm run dev`）。`build` 只负责 Vite 构建，首次开发与刷新数据时先运行 `sync-data`。数据写入忽略跟踪的 `public/data.json`；不提交生成物。

浏览器测试使用同一份构建结果：

```sh
pnpm exec playwright install --with-deps chromium
pnpm run test:e2e
```

## 源码

- `src/App.vue`：单组件实现版面、搜索、状态筛选、详情、主题与复制。
- `scripts/sync.mjs`：从仓库发现候选包，查询 npm 并生成数据快照。
- `vite.config.mjs`：Vue Vapor 编译与 Vite+ 测试配置。

不做排序控件、分页或搜索筛选的 URL 同步；所有匹配包直接展示。包详情支持 `?package=包名` 直达和复制分享链接，无需 Router。

组件全部使用 `<script setup vapor>`，入口使用 `createVaporApp`，不是普通 Vue Virtual DOM 应用。Vue 与编译器通过 lockfile 对齐并锁定 RC；升级时必须重跑浏览器验证。

## 鸿蒙与跨平台

上游 Vite+ 尚未发布 openharmony 平台包，因此使用完整、保留其他平台产物的 `@ohos-npm-ports/vite-plus`。相关 yuku、lightningcss 和 tsgolint 通过 overrides 使用社区 port；Vite/Vitest 与工具链版本对齐。Rolldown 的原生 openharmony binding 以 optionalDependency 补充，不影响其他平台安装；`ohos-signpost` postinstall 处理本机原生模块签名。所有平台使用同一份依赖与 lockfile。

## 数据与部署

版本与废弃状态来自官方 npm registry，不猜测稳定性、发布来源或设备兼容性。仅收录仓库相关且 registry 确认存在的候选包；不是整个 scope 的历史归档。无法确认上游包名时，不生成猜测的 alias。网络错误重试后终止同步，不发布不完整快照。

GitHub Pages 的来源须设为 **GitHub Actions**。Website CI 仅在 Linux 执行安装、检查、测试、同步数据、构建与桌面/手机浏览器验证；PR 仅上传页面和截图，main 更新、每日定时和手动触发可部署。不修改 port 或 npm 发布流程。

### 临时依赖兼容

`patches/vite-plus.patch` 通过 pnpm 的 patchedDependencies 应用：仅在包名为社区 port 时，从 CLI 版本中剥离移植修订号，再与 core 版本精确比较。当前 port 的 `1.0.0-1` 否则会错误地要求不存在的 core `1.0.0-1`，而非上游 core `1.0.0`。未修改 node_modules 的生成脚本，也没有自制构建器；port 修复并发布后可删除此补丁。

当前移植工具链的 Vitest 开发服务依赖存在 npm audit moderate 告警。本站使用 Node 模式一次性测试，不开启 Vitest UI/Browser 服务，部署内容仅为静态文件；不要将开发/测试服务开放到公网。后续升级工具链时需同步核对社区 port 与告警修复状态。
