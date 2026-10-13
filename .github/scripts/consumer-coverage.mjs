import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closure, testSpec } from './consumer-plan.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const excluded = JSON.parse(readFileSync(join(repo, '.github/fixtures/consumer/excluded-ports.json')));
const directories = [];
for (const port of readdirSync(join(repo, 'ports'))) {
  for (const version of readdirSync(join(repo, 'ports', port))) {
    const dir = `ports/${port}/${version}`;
    if (existsSync(join(repo, dir, 'build.sh'))) directories.push(dir);
  }
}
// Ports are onboarded one pull request at a time; set CONSUMER_REQUIRE_ALL=true to make a missing test.js fatal.
for (const dir of directories) {
  if (testSpec(dir)) continue;
  if (process.env.CONSUMER_REQUIRE_ALL === 'true') assert.fail(`Missing test.js: ${dir}`);
  console.error(`::warning::Missing test.js: ${dir}`);
}
const active = directories.filter((dir) => !Object.hasOwn(excluded, dir.split('/')[1]) && testSpec(dir)?.role === 'primary');
const supporting = new Set(closure(active).filter((dir) => testSpec(dir)?.role === 'support'));
// While ports are onboarded one pull request at a time, a support test may land before its parent.
for (const dir of directories.filter((dir) => testSpec(dir)?.role === 'support' && !supporting.has(dir))) {
  if (process.env.CONSUMER_REQUIRE_ALL === 'true') assert.fail(`Orphan support test: ${dir}`);
  console.error(`::warning::Orphan support test (parent not onboarded yet): ${dir}`);
}
const rows = directories.sort().map((dir) => {
  const spec = testSpec(dir);
  const port = dir.split('/')[1];
  const status = Object.hasOwn(excluded, port) ? '暂时排除'
    : supporting.has(dir) ? '配套产物；主包带测'
    : spec ? '已接入；结果以本轮 CI 为准' : '未接入 consumer';
  return { dir, status, upstream: spec?.upstream ?? '—', project: spec?.project ?? '—',
    platforms: spec ? spec.platforms.join(', ') : '—', reason: excluded[port] ?? spec?.reason ?? '—' };
});
console.log('## Consumer coverage inventory');
console.log(`\n共 ${new Set(directories.map((dir) => dir.split('/')[1])).size} 个 port 名称、${rows.length} 个版本目录；${active.length} 个版本已接入测试，${supporting.size} 个配套构建目录。`);
console.log('\n此表仅表示测试配置覆盖，不代表运行通过。各 OS 的实际结果必须查看 consumer job 摘要；未接入不能视为已验证。\n');
console.log('| port/version | 状态 | 原始包名 | 工程 | 平台 | 排除/限制原因 |');
console.log('|---|---|---|---|---|---|');
for (const row of rows) console.log(`| ${row.dir} | ${row.status} | ${row.upstream} | ${row.project} | ${row.platforms} | ${row.reason} |`);
