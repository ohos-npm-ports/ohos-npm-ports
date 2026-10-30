const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const input = process.argv[2];
async function load(platform) {
  let source = fs.readFileSync(input, 'utf8');
  const replacements = [
    ['import process from "node:process";', `const process = { platform: ${JSON.stringify(platform)} };`],
    ['const getUpstream = async options => (await import("@nwutils/getter")).default(options);', 'const getUpstream = async options => ({ route: "get", options });'],
    ['import runUpstream from "@nwutils/runner";', 'const runUpstream = async options => ({ route: "run", options });'],
    ['import util from "./util.js";', 'const util = { findpath: async (executable, options) => ({ route: "path", executable, options }) };'],
    ['import ohos from "./ohos/runtime.cjs";', 'const ohos = { verifyBackend: () => "verified", run: async options => ({ route: "bridge", options }) };'],
  ];
  for (const [before, after] of replacements) { assert.ok(source.includes(before)); source = source.replace(before, after); }
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}
for (const platform of ['linux', 'darwin', 'win32']) test(`${platform} delegates all upstream APIs without option changes`, async () => {
  const api = await load(platform);
  const options = { version: '0.119.2', flavor: 'sdk', platform: 'linux' };
  assert.equal((await api.get(options)).options, options);
  assert.equal((await api.run(options)).options, options);
  assert.deepEqual(await api.findpath('chromedriver', options), { route: 'path', executable: 'chromedriver', options });
});
test('OpenHarmony uses the bridge and rejects unsupported native-runtime APIs', async () => {
  const api = await load('openharmony');
  assert.equal(await api.get(), 'verified');
  assert.equal((await api.run({ srcDir: '/app' })).route, 'bridge');
  await assert.rejects(api.findpath(), /No standalone/);
  await assert.rejects(api.get({ flavor: 'sdk' }), /SDK/);
  await assert.rejects(api.run({ version: '0.119.2' }), /cannot be selected/);
});
