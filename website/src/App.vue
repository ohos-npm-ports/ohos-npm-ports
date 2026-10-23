<script setup vapor>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
const favicon = computed(
  () => `${import.meta.env.BASE_URL}favicon${theme.value === "dark" ? "-dark" : ""}.svg`,
);
const packages = ref([]);
const loading = ref(true);
const error = ref(false);
const ready = ref(false);
const generatedAt = ref("");
const selected = ref(null);
const toast = ref("");
let timer;
const activeCount = computed(() => packages.value.filter((p) => p.status === "active").length);
const versionsCount = computed(() => packages.value.reduce((sum, p) => sum + p.versions.length, 0));
const theme = ref(initialTheme());
function initialTheme() {
  try {
    return (
      localStorage.getItem("theme") ||
      (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    );
  } catch {
    return "light";
  }
}
watch(
  theme,
  (value) => {
    document.body.dataset.theme = value;
    document.querySelector('link[rel="icon"]').href = favicon.value;
    try {
      localStorage.setItem("theme", value);
    } catch {
      /* Theme remains usable without storage. */
    }
  },
  { immediate: true },
);
function toggleTheme() {
  theme.value = theme.value === "dark" ? "light" : "dark";
}
async function load() {
  loading.value = true;
  error.value = false;
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}data.json`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.packages)) throw new Error("Invalid catalog");
    packages.value = data.packages;
    generatedAt.value = data.generatedAt;
    ready.value = true;
    const name = new URL(location.href).searchParams.get("package");
    if (name) {
      const pkg = packages.value.find((p) => p.name === name || p.shortName === name);
      if (pkg) await openDetail(pkg);
      else toast.value = "未找到该包，请在目录中搜索其他包。";
    }
  } catch {
    error.value = true;
  } finally {
    loading.value = false;
  }
}
async function copy(text) {
  clearTimeout(timer);
  try {
    if (!text) throw new Error("No command");
    await navigator.clipboard.writeText(text);
    toast.value = "已复制到剪贴板";
  } catch {
    toast.value = "无法写入剪贴板，请在包详情中选中并复制命令。";
  }
  timer = setTimeout(() => {
    toast.value = "";
  }, 3500);
}
onMounted(load);
onUnmounted(() => clearTimeout(timer));

const labels = {
  all: "全部包",
  active: "可用 latest",
  deprecated: "已废弃",
  untagged: "无 latest 标签",
};
const query = ref("");
const status = ref("all");
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  const candidates = packages.value.filter(
    (p) => status.value === "all" || p.status === status.value,
  );
  if (!q) return candidates;
  return candidates
    .map((pkg) => ({
      pkg,
      rank: [pkg.name, pkg.upstream, pkg.description].findIndex((text) =>
        text?.toLowerCase().includes(q),
      ),
    }))
    .filter((match) => match.rank >= 0)
    .sort((a, b) => a.rank - b.rank)
    .map((match) => match.pkg);
});
function clear() {
  query.value = "";
  status.value = "all";
}
const dialog = ref(null);
const version = ref("");
const mode = ref("npm");
const code = computed(
  () => selected.value && installText(selected.value, mode.value, version.value),
);
const deprecated = computed(
  () => selected.value?.versions.find((v) => v.version === version.value)?.deprecated,
);
function packageUrl(pkg) {
  const url = new URL(import.meta.env.BASE_URL, location.origin);
  url.searchParams.set("package", pkg.name);
  return url.href;
}
function closeDetail() {
  selected.value = null;
  const url = new URL(location.href);
  url.searchParams.delete("package");
  history.replaceState(null, "", url);
}
async function openDetail(pkg) {
  selected.value = pkg;
  version.value = pkg.version || pkg.versions[0]?.version || "";
  mode.value = "npm";
  await nextTick();
  dialog.value.showModal();
  history.replaceState(null, "", packageUrl(pkg));
}
function installText(pkg, mode = "npm", version = pkg.version) {
  if (!version) return null;
  const spec = `${pkg.name}@${version}`;
  if (mode === "npm") return `npm install ${pkg.upstream ? `${pkg.upstream}@npm:` : ""}${spec}`;
  if (!pkg.upstream) return null;
  return JSON.stringify({ [mode]: { [pkg.upstream]: `npm:${spec}` } }, null, 2);
}
</script>

<template>
  <a class="skip" href="#catalog">跳到包目录</a>
  <header class="header">
    <div class="shell nav">
      <a class="brand" href="./" aria-label="ohos-npm-ports 首页"
        ><img :src="favicon" width="34" height="34" alt="" /><span
          >ohos<span class="brand-light"> / </span>npm-ports</span
        ></a
      >
      <nav aria-label="主导航">
        <a class="nav-current" href="#catalog">包目录</a
        ><a
          href="https://github.com/ohos-npm-ports/ohos-npm-ports/blob/main/docs/zh-CN/user/usage.md"
          >使用指南 ↗</a
        ><a href="https://github.com/ohos-npm-ports/ohos-npm-ports">GitHub ↗</a
        ><button
          id="theme"
          @click="toggleTheme"
          class="icon-button"
          aria-label="切换深浅主题"
          title="切换深浅主题"
        >
          ◐
        </button>
      </nav>
    </div>
  </header>
  <main class="shell">
    <section class="hero" aria-labelledby="hero-title">
      <div class="hero-copy">
        <div class="eyebrow"><span class="dot"></span> OPEN SOURCE · OPENHARMONY</div>
        <h1 id="hero-title">
          熟悉的 npm 包，<br />也能在<span class="highlight">鸿蒙上运行。</span>
        </h1>
        <p class="hero-description">
          查找社区移植包，确认版本，复制接入配置。<br />让你的下一个项目，从这里开始。
        </p>
        <div class="hero-actions">
          <a class="button primary" href="#catalog">探索包目录 <span>↓</span></a
          ><a
            class="text-link"
            href="https://github.com/ohos-npm-ports/ohos-npm-ports/blob/main/docs/zh-CN/contributor/contributing.md"
            >参与移植 <span>↗</span></a
          >
        </div>
        <div class="hero-note">优先使用上游原生支持；社区 port 是过渡方案。</div>
      </div>
      <div class="terminal" aria-label="通过 npm alias 保持原有导入名的接入示例">
        <div class="terminal-bar">
          <span class="terminal-dots"><i></i><i></i><i></i></span><span>~/your-next-project</span
          ><span>⌘</span>
        </div>
        <div class="terminal-content">
          <div class="terminal-comment"># 保留原来的 import，换上适配后的包</div>
          <div class="terminal-command">
            <span>❯</span> npm install \<br /><span class="terminal-indent"
              >sqlite3@npm:@ohos-npm-ports/sqlite3</span
            >
          </div>
          <div class="terminal-divider"></div>
          <div class="terminal-comment">// package.json</div>
          <pre v-pre><span class="code-muted">{</span>
  <span class="code-key">"dependencies"</span>: {
    <span class="code-key">"sqlite3"</span>: <span class="code-value">"npm:@ohos-npm-ports/sqlite3"</span>
  }
<span class="code-muted">}</span></pre>
          <div class="terminal-foot"><span class="dot"></span> 一个别名，连接你的开发环境。</div>
        </div>
      </div>
    </section>
    <section class="stats" aria-label="包目录统计">
      <div>
        <strong id="total-count">{{ ready ? packages.length : "—" }}</strong
        ><span>已发布的包</span>
      </div>
      <div>
        <strong id="active-count">{{ ready ? activeCount : "—" }}</strong
        ><span>latest 未标记废弃</span>
      </div>
      <div>
        <strong id="versions-count">{{ ready ? versionsCount : "—" }}</strong
        ><span>已发布的版本</span>
      </div>
      <p>
        <span class="dot"></span> npm registry 数据快照<br /><time
          id="updated"
          :datetime="generatedAt"
          >{{
            generatedAt
              ? new Date(generatedAt).toLocaleString("zh-CN", { hour12: false }) + " 更新"
              : "正在读取更新信息"
          }}</time
        >
      </p>
    </section>

    <section class="catalog-section" id="catalog" aria-labelledby="catalog-title">
      <div class="section-heading">
        <div class="eyebrow">THE PACKAGE DIRECTORY</div>
        <div class="heading-line">
          <h2 id="catalog-title">找到你需要的工具。</h2>
          <a href="https://www.npmjs.com/org/ohos-npm-ports">在 npm 上查看 ↗</a>
        </div>
      </div>
      <div class="catalog-layout">
        <aside class="sidebar">
          <h3>发布状态</h3>
          <div id="filters" class="filters" role="group" aria-label="按发布状态筛选">
            <button
              v-for="(label, value) in labels"
              :key="value"
              :data-status="value"
              :aria-pressed="status === value"
              @click="status = value"
            >
              {{ label }}
              <span :id="'filter-' + value">{{
                value === "all"
                  ? packages.length
                  : packages.filter((p) => p.status === value).length
              }}</span>
            </button>
          </div>
          <div class="sidebar-note">
            <span class="note-icon">↗</span>
            <h3>把适配带回上游</h3>
            <p>上游已支持 OpenHarmony？请优先使用官方包，减少额外的维护。</p>
            <a
              href="https://github.com/ohos-npm-ports/ohos-npm-ports/blob/main/docs/zh-CN/contributor/porting-guide.md"
              >了解移植原则 →</a
            >
          </div>
        </aside>
        <div class="catalog-main">
          <div class="toolbar">
            <label class="search"
              ><span aria-hidden="true">⌕</span
              ><input
                id="search"
                v-model="query"
                type="search"
                placeholder="搜索包名、上游包或描述…"
                aria-label="搜索包"
            /></label>
          </div>
          <div class="results-meta">
            <p id="result-count" role="status">
              {{
                loading
                  ? "正在加载包目录…"
                  : error
                    ? "目录加载失败"
                    : `找到 ${filtered.length} 个包 / 共 ${packages.length} 个`
              }}
            </p>
            <span>点击包名，查看接入方式</span>
          </div>
          <div class="list-head" aria-hidden="true">
            <span>包 / PACKAGE</span><span>LATEST</span><span>操作</span>
          </div>
          <div id="packages" class="packages" :aria-busy="loading" :hidden="error">
            <div v-if="loading" class="empty">正在读取 npm 数据快照…</div>
            <div v-else-if="!filtered.length" class="empty">
              <h3>没有找到匹配的包</h3>
              <p>试试其他关键词，或清除筛选条件。</p>
              <button class="button" @click="clear">清除搜索与筛选</button>
            </div>
            <template v-else>
              <article v-for="pkg in filtered" :key="pkg.name" class="package-row">
                <div class="package-main">
                  <div class="package-icon" aria-hidden="true">
                    {{ pkg.shortName.replace(/[^a-z]/gi, "").slice(0, 2) }}
                  </div>
                  <div class="package-info">
                    <button
                      class="package-name"
                      :aria-label="`查看 ${pkg.shortName} 包详情`"
                      @click="openDetail(pkg)"
                    >
                      {{ pkg.shortName }}
                    </button>
                    <p class="package-description">{{ pkg.description }}</p>
                    <p class="upstream">{{ pkg.upstream ? `↳ ${pkg.upstream}` : pkg.name }}</p>
                  </div>
                </div>
                <div class="package-version">
                  {{ pkg.version || "—" }}<br /><span :class="['status-badge', pkg.status]"
                    ><span class="dot"></span>{{ labels[pkg.status] }}</span
                  >
                </div>
                <button
                  class="copy-row"
                  :aria-label="`复制 ${pkg.shortName} 安装命令`"
                  title="复制安装命令"
                  :disabled="!pkg.version"
                  @click="copy(installText(pkg))"
                >
                  ⧉
                </button>
              </article>
            </template>
          </div>
          <div id="error" class="error" :hidden="!error">
            <h3>暂时无法加载包目录</h3>
            <p>请检查网络后重试，或前往 npm 查看包信息。</p>
            <button class="button" id="retry" @click="load">重新加载</button>
          </div>
        </div>
      </div>
    </section>

    <section class="getting-started" aria-labelledby="start-title">
      <div>
        <span class="eyebrow">A SMALL CHANGE. A NEW PLATFORM.</span>
        <h2 id="start-title">第一次使用社区移植包？</h2>
        <p>
          直接依赖用 npm alias，间接依赖用 overrides。<br />安装成功之后，还需要在目标设备验证加载与运行。
        </p>
      </div>
      <a
        class="button"
        href="https://github.com/ohos-npm-ports/ohos-npm-ports/blob/main/docs/zh-CN/user/usage.md"
        >阅读接入指南 ↗</a
      >
    </section>
    <div class="compat-note">
      <span>i</span>
      <p>
        这里的“可用 latest”仅表示 npm 的 latest 版本未标记废弃，不代表真机验收通过。使用 npm / pnpm
        安装原生模块时，可能还需要
        <a href="https://www.npmjs.com/package/ohos-signpost">ohos-signpost</a>
        签名；Bun 已内置签名。请以具体包的说明和目标设备实测为准。
      </p>
    </div>
  </main>
  <footer class="shell footer">
    <a class="brand" href="./"
      ><img :src="favicon" width="24" height="24" alt="" /><span
        >ohos<span class="brand-light"> / </span>npm-ports</span
      ></a
    ><span>为 OpenHarmony 生态贡献一块拼图。</span
    ><a href="https://github.com/ohos-npm-ports/ohos-npm-ports">源码与贡献 ↗</a>
  </footer>

  <dialog ref="dialog" id="detail" aria-labelledby="detail-title" @close="closeDetail">
    <template v-if="selected">
      <div class="dialog-head">
        <span class="eyebrow">PACKAGE DETAILS</span
        ><button
          id="close-detail"
          class="icon-button"
          aria-label="关闭包详情"
          @click="dialog.close()"
        >
          ×
        </button>
      </div>
      <h2 id="detail-title">{{ selected.shortName }}</h2>
      <p id="detail-description">{{ selected.description }}</p>
      <p id="detail-warning" class="warning" :hidden="!deprecated">
        该版本已废弃：{{ deprecated }}
      </p>
      <div id="detail-links" class="detail-links">
        <a :href="`https://www.npmjs.com/package/${selected.name}`">npm 包 ↗</a
        ><a v-if="selected.upstream" :href="`https://www.npmjs.com/package/${selected.upstream}`"
          >上游包 ↗</a
        ><a
          v-if="selected.directories[0]"
          :href="`https://github.com/ohos-npm-ports/ohos-npm-ports/tree/main/${selected.directories[0].split('/').slice(0, 2).join('/')}`"
          >构建与补丁 ↗</a
        ><span v-if="selected.license">{{ selected.license }}</span>
      </div>
      <div class="version-control">
        <label for="version">发布版本</label
        ><select id="version" v-model="version">
          <option v-for="v in selected.versions" :key="v.version" :value="v.version">
            {{ v.version }}{{ v.tags.length ? ` · ${v.tags.join(", ")}` : ""
            }}{{ v.deprecated ? " · 已废弃" : "" }}
          </option>
        </select>
      </div>
      <div id="install-modes" class="install-modes" role="group" aria-label="接入方式">
        <button
          v-for="(label, value) in {
            npm: 'npm alias',
            dependencies: 'dependencies',
            overrides: 'overrides',
          }"
          :key="value"
          :data-mode="value"
          :aria-pressed="mode === value"
          @click="mode = value"
        >
          {{ label }}
        </button>
      </div>
      <pre id="install-code" tabindex="0">{{
        code ||
        (mode === "npm"
          ? "该包没有可选发布版本。"
          : "无法从构建文件确认上游包名。请根据包文档手动配置别名，不要猜测映射。")
      }}</pre>
      <button id="copy-detail" class="button primary" :disabled="!code" @click="copy(code)">
        {{ mode === "npm" ? "复制安装命令" : "复制配置" }}
      </button>
      <button class="button" @click="copy(packageUrl(selected))">复制分享链接</button>
      <p class="dialog-note">
        npm alias 保持原有导入名；overrides 用于间接依赖。pnpm 的 overrides 配置写入
        pnpm-workspace.yaml，不照搬 npm 配置。
      </p>
    </template>
  </dialog>

  <div id="toast" role="status" class="toast" :hidden="!toast">{{ toast }}</div>
</template>
