// @test-prerequisite: ports/p/playwright-core
// @test-setup: true
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const version = '0.0.84';

function verifyStdio(cli) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli], { stdio: ['pipe', 'pipe', 'inherit'] });
    let buffer = '';
    let settled = false;
    const timer = setTimeout(() => finish(Error('handshake timeout')), 30000);
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill();
      if (error) reject(error);
      else resolve();
    }
    child.once('error', finish);
    child.once('close', (code, signal) => {
      if (!settled) finish(Error(`MCP exited before handshake completed: ${signal ?? code}`));
    });
    child.stdin.once('error', finish);
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        try {
          if (message.id === 1) {
            assert.ok(message.result, `bad initialize response: ${line}`);
            child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
          } else if (message.id === 2) {
            const names = (message.result?.tools ?? []).map((tool) => tool.name);
            assert.ok(names.length > 0, `bad tools/list response: ${line}`);
            for (const required of ['browser_navigate', 'browser_snapshot', 'browser_take_screenshot']) {
              assert.ok(names.includes(required), `missing MCP tool: ${required}`);
            }
            finish();
            return;
          }
        } catch (error) {
          finish(error);
          return;
        }
      }
    });
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'port-smoke', version: '0' } },
    })}\n`);
  });
}

export function setup({ projectDir, mode }) {
  if (!process.env.PLAYWRIGHT_CORE_TARBALL || mode === 'baseline') return;
  const file = join(projectDir, 'package.json');
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  pkg.overrides ??= {};
  pkg.overrides['playwright-core'] = `file:${process.env.PLAYWRIGHT_CORE_TARBALL}`;
  writeFileSync(file, JSON.stringify(pkg, null, 2));
}

export default async function test({ requirePackage, resolvePackage, run, mode }) {
  const core = requirePackage('playwright-core/package.json');
  if (mode === 'overrides') assert.equal(core.name, '@ohos-npm-ports/playwright-core');
  const manifestPath = resolvePackage('@playwright/mcp/package.json');
  const cli = join(dirname(manifestPath), 'cli.js');
  const versionOutput = run(process.execPath, [cli, '--version'], { capture: true }).stdout;
  assert.ok(versionOutput.includes(`Version ${version}`), versionOutput);
  run(process.execPath, [cli, '--help']);
  const { tools } = requirePackage('playwright-core/lib/coreBundle');
  const names = tools.browserTools.map((tool) => tool.schema?.name ?? tool.name).filter(Boolean);
  for (const required of ['browser_navigate', 'browser_click', 'browser_snapshot', 'browser_take_screenshot', 'browser_evaluate']) {
    assert.ok(names.includes(required), `missing tool: ${required}`);
  }
  const mcp = requirePackage('@playwright/mcp');
  assert.equal(typeof mcp.createConnection, 'function');
  await verifyStdio(cli);
  return {
    result: { cliVersion: version, createConnection: true, browserTools: true, stdio: true },
    assets: [],
  };
}
