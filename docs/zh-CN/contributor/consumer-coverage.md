# 全量 consumer 功能验证

每个需要接入矩阵的 NPMBUILD 配方在根目录包含有效 test.js。primary 配方分别运行五 OS consumer；槽位与主包放在同一配方，由该配方的 artifact 和测试共同覆盖，不再作为独立 support port。接入期间缺 test.js 仅警告；全部接入后可设置 CONSUMER_REQUIRE_ALL=true 改为强制。

默认使用最小 Node 工程，API、CLI、数据库、Bun、终端与浏览器测试由各配方实现。前端模板按需使用，专属 fixture 放在配方内。测试协议见 `.github/fixtures/consumer/README.md`。

CI summary 由 consumer-coverage.mjs 动态生成；存在测试仅表示已接入，不表示实际通过。缺少测试、产物、运行时、超时或功能断言失败均不能算成功。槽位在 OpenHarmony 验证安装和主包功能，在其他平台验证不会被错误选择。

构建后通过 NPMBUILD manifest 发布到临时 Verdaccio，导出实际发布 tarball 和 integrity。每个 OS 在自己的 Verdaccio 重新发布本轮依赖闭包，再运行 install、npm ci 和功能测试。普通 OS 比较原始 baseline 与 overrides 的确定性结果；OpenHarmony 运行 overrides。不得用 npmjs 上旧版 port 代替本轮产物。

Bun 专项测试使用同轮 Bun；Playwright 在 OpenHarmony 使用宿主临时浏览器服务，验证远程浏览器操作，不宣称本地浏览器支持。构建并发 4，普通 consumer 使用各 job 的矩阵并发限制，OpenHarmony consumer 并发 4，artifact 保留 7 天。

完整覆盖以同一提交全部矩阵通过为准；不覆盖 ia32、musl、其他 CPU、全部 Node/npm 版本、真实设备沙箱或完整业务负载。
