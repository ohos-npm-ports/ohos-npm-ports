// @test-platforms: openharmony
// @test-platform-reason: 需要 OpenHarmony 原生槽位和 Bun compile 运行时。
// @test-setup: true
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function setup({ projectDir, run }) {
  run('brew', ['install', 'bun']);
  const file = join(projectDir, 'package.json');
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  pkg.dependencies ??= {};
  pkg.dependencies['web-tree-sitter'] = '0.25.10';
  writeFileSync(file, JSON.stringify(pkg, null, 2));
}

export default function test({ projectDir, run }) {
  writeFileSync(join(projectDir, 'app.mjs'), `import { createTestRenderer } from "@opentui/core/testing"
import { BoxRenderable } from "@opentui/core"

const setup = await createTestRenderer({ width: 30, height: 10 })
const box = new BoxRenderable(setup.renderer, { width: 10, height: 3, border: true, title: "ohos" })
setup.renderer.root.add(box)
await setup.renderOnce()
const frame = setup.captureCharFrame()
if (!frame.includes("ohos")) throw new Error("frame missing box title")
console.log("SMOKE-OK bun-render")
await setup.renderer.destroy()
`);
  run('bun', ['app.mjs'], { cwd: projectDir });
  run('bun', ['build', '--compile', 'app.mjs', '--outfile', 'smoke-bin'], { cwd: projectDir });
  const isolatedDir = join(projectDir, 'isolated');
  mkdirSync(isolatedDir, { recursive: true });
  cpSync(join(projectDir, 'smoke-bin'), join(isolatedDir, 'smoke-bin'));
  run(join(isolatedDir, 'smoke-bin'), [], { cwd: isolatedDir });
  writeFileSync(join(projectDir, 'node-import.mjs'), 'import "@opentui/core";\nconsole.log("SMOKE-OK node-import");\n');
  run(process.execPath, ['node-import.mjs'], { cwd: projectDir });
  return {
    result: { bunRender: true, bunCompile: true, nodeImport: true },
    assets: [],
  };
}
