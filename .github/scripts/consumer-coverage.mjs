import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closure, testSpec } from './consumer-plan.mjs';
import { discoverPorts } from '../../cli/port.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const excluded = JSON.parse(readFileSync(join(repo, '.github/fixtures/consumer/excluded-ports.json')));
const directories = discoverPorts(repo).map((dir) => relative(repo, dir));
for (const dir of directories) {
  if (testSpec(dir)) continue;
  if (process.env.CONSUMER_REQUIRE_ALL === 'true') assert.fail(`Missing test.js: ${dir}`);
  console.error(`::notice::No functional test.js: ${dir}; generic install matrix still applies`);
}
const active = directories.filter((dir) => !Object.hasOwn(excluded, basename(dir)) && testSpec(dir)?.role === 'primary');
const supporting = new Set(closure(active).filter((dir) => testSpec(dir)?.role === 'support'));
for (const dir of directories.filter((dir) => testSpec(dir)?.role === 'support' && !supporting.has(dir))) {
  if (process.env.CONSUMER_REQUIRE_ALL === 'true') assert.fail(`Orphan support test: ${dir}`);
  console.error(`::warning::Orphan support test (parent not onboarded yet): ${dir}`);
}
const rows = directories.sort().map((dir) => {
  const spec = testSpec(dir);
  const port = basename(dir);
  const status = Object.hasOwn(excluded, port) ? '暂时排除'
    : supporting.has(dir) ? '配套产物；主包带测'
    : spec ? '通用安装 + 功能测试' : '通用安装；无功能测试';
  return { dir, status, upstream: spec?.upstream ?? '—', project: spec?.project ?? '—',
    platforms: spec ? spec.platforms.join(', ') : '—', reason: excluded[port] ?? spec?.reason ?? '—' };
});
console.log('## Consumer coverage inventory');
console.log(`\n全部 ${rows.length} 个 port 默认进入通用安装矩阵；${active.length} 个 port 另有功能测试，${supporting.size} 个配套 port。`);
console.log('\n通用安装覆盖不等于功能验证通过，各 OS 的实际结果必须查看对应 job 摘要。槽位产物随主 port 测试，不单独列为 port。\n');
console.log('| port | 状态 | 原始包名 | 工程 | 平台 | 排除/限制原因 |');
console.log('|---|---|---|---|---|---|');
for (const row of rows) console.log(`| ${row.dir} | ${row.status} | ${row.upstream} | ${row.project} | ${row.platforms} | ${row.reason} |`);
