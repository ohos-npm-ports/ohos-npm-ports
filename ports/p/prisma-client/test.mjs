// @test-setup: true
// @test-timeout: 1800
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

function commandAvailable(command, run) {
  try {
    run(command, ['--version'], { capture: true });
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

export function setup({ projectDir, version }) {
  const projectFile = join(projectDir, 'package.json');
  const project = JSON.parse(readFileSync(projectFile, 'utf8'));
  project.dependencies ??= {};
  Object.assign(project.dependencies, { prisma: version, 'sql.js': '1.15.2', typescript: '5.9.3' });
  writeFileSync(projectFile, JSON.stringify(project, null, 2));
  const app = join(projectDir, 'app');
  mkdirSync(app, { recursive: true });
  for (const file of ['schema.prisma', 'sqljs-adapter.cjs', 'smoke.cjs']) {
    cpSync(join(import.meta.dirname, 'tests', file), join(app, file));
  }
}

export default function test({ requirePackage, resolvePackage, run, projectDir, mode, version, revision }) {
  const app = join(projectDir, 'app');
  const pkg = requirePackage('@prisma/client/package.json');
  assert.equal(pkg.version, mode === 'overrides' ? `${version}-${revision}` : version);
  assert.equal(pkg.name, mode === 'overrides' ? '@ohos-npm-ports/prisma-client' : '@prisma/client');
  const cliPkg = requirePackage('prisma/package.json');
  const cli = join(dirname(resolvePackage('prisma/package.json')), cliPkg.bin.prisma);
  const generated = run(process.execPath, [cli, 'generate', '--schema', 'schema.prisma'], { cwd: app, capture: true });
  assert.ok(`${generated.stdout}${generated.stderr}`.includes('Generated Prisma Client'));
  const typescriptPkg = requirePackage('typescript/package.json');
  const tsc = join(dirname(resolvePackage('typescript/package.json')), typescriptPkg.bin.tsc);
  run(process.execPath, [
    tsc, '--module', 'commonjs', '--target', 'es2022', '--moduleResolution', 'node',
    '--esModuleInterop', '--skipLibCheck', '--outDir', 'generated', 'client/client.ts',
  ], { cwd: app });
  run(process.execPath, ['smoke.cjs'], { cwd: app });
  const bun = commandAvailable('bun', run);
  if (bun) run('bun', ['smoke.cjs'], { cwd: app });
  return { result: { generate: true, crud: true, bunCrud: bun }, assets: [] };
}
