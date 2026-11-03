// @test-setup: true
// @test-timeout: 1800
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const version = '8.0.0-rc.29';
const ormVersion = '8.0.0-rc.21';

function commandAvailable(command, run) {
  try {
    run(command, ['--version'], { capture: true });
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

export function setup({ projectDir }) {
  const projectFile = join(projectDir, 'package.json');
  const project = JSON.parse(readFileSync(projectFile, 'utf8'));
  project.dependencies ??= {};
  project.dependencies['@prisma/orm-postgres'] = ormVersion;
  writeFileSync(projectFile, JSON.stringify(project, null, 2));
  const app = join(projectDir, 'app');
  mkdirSync(app, { recursive: true });
  writeFileSync(join(app, 'prisma.config.ts'), `import { definePrismaConfig } from 'prisma/config';
import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';

export default definePrismaConfig({
  orm: ormConfig({
    contract: './contract.prisma',
  }),
});
`);
  writeFileSync(join(app, 'contract.prisma'), `// use prisma-8
model Widget {
  id   Int    @id @default(autoincrement())
  name String
}
`);
}

export default function test({ requirePackage, resolvePackage, run, projectDir, mode, portVersion }) {
  const app = join(projectDir, 'app');
  const pkg = requirePackage('prisma/package.json');
  const expectedVersion = mode === 'overrides' ? portVersion : version;
  assert.equal(pkg.version, expectedVersion);
  assert.equal(pkg.name, mode === 'overrides' ? '@ohos-npm-ports/prisma' : 'prisma');
  const cli = join(dirname(resolvePackage('prisma/package.json')), pkg.bin.prisma);
  const env = {
    DO_NOT_TRACK: '1',
    PRISMA_DISABLE_TELEMETRY: '1',
    PRISMA_CLI_UPDATE_CHECK_DIR: join(projectDir, 'update-check'),
  };
  const versionResult = run(process.execPath, [cli, '--version'], { cwd: app, env, capture: true });
  const versionOutput = `${versionResult.stdout}${versionResult.stderr}`;
  assert.ok(versionOutput.split('\n').map((line) => line.trim()).includes(expectedVersion), versionOutput);
  const emit = run(process.execPath, [cli, 'contract', 'emit'], { cwd: app, env, capture: true });
  assert.ok(`${emit.stdout}${emit.stderr}`.includes('Emitted contract.json and contract.d.ts'));
  assert.ok(statSync(join(app, 'contract.json')).size > 0);
  assert.ok(statSync(join(app, 'contract.d.ts')).size > 0);
  assert.ok(readFileSync(join(app, 'contract.d.ts'), 'utf8').includes('public_Widget'));
  const contract = JSON.parse(readFileSync(join(app, 'contract.json'), 'utf8'));
  assert.ok(contract.roots?.Widget, 'emitted contract is missing the Widget root');
  const print = run(process.execPath, [cli, 'contract', 'print', '--format', 'human'], { cwd: app, env, capture: true });
  assert.ok(print.stdout.includes('namespace public'), `${print.stdout}${print.stderr}`);
  assert.ok(print.stdout.includes('model Widget'), `${print.stdout}${print.stderr}`);
  const bun = commandAvailable('bun', run);
  if (bun) {
    rmSync(join(app, 'contract.json'), { force: true });
    rmSync(join(app, 'contract.d.ts'), { force: true });
    const bunEmit = run('bun', [cli, 'contract', 'emit'], { cwd: app, env, capture: true });
    assert.ok(`${bunEmit.stdout}${bunEmit.stderr}`.includes('Emitted contract.json and contract.d.ts'));
    assert.ok(statSync(join(app, 'contract.json')).size > 0);
    assert.ok(statSync(join(app, 'contract.d.ts')).size > 0);
  }
  return {
    result: { cliVersion: version, contractEmit: true, contractPrint: true, bunEmit: bun },
    assets: [],
  };
}
