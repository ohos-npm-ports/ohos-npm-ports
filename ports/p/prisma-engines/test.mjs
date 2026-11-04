// @test-platforms: openharmony
// @test-platform-reason: 原生 Prisma 引擎和 CLI 往返需要 OpenHarmony 运行时。
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const commit = '6a3747c37ff169c90047725a05a6ef02e32ac97e';

export default async function test({ requirePackage, run, version }) {
  const engines = requirePackage('@prisma/engines');
  for (const key of [
    'getEnginesPath', 'ensureBinariesExist', 'getCliQueryEngineBinaryType',
    'enginesVersion', 'DEFAULT_CLI_QUERY_ENGINE_BINARY_TYPE',
  ]) {
    assert.notEqual(engines[key], undefined, `missing compat export: ${key}`);
  }
  assert.equal(engines.DEFAULT_CLI_QUERY_ENGINE_BINARY_TYPE, 'libquery-engine');
  assert.equal(engines.enginesVersion, commit);
  const enginesPath = engines.getEnginesPath();
  const queryAlias = join(enginesPath, 'libquery_engine-debian-openssl-1.1.x.so.node');
  assert.ok(existsSync(queryAlias));
  assert.ok(existsSync(join(enginesPath, 'schema-engine-debian-openssl-1.1.x')));
  const library = requirePackage(queryAlias);
  assert.equal(library.version().commit, commit);

  const directory = mkdtempSync(join(tmpdir(), 'prisma-engines-smoke-'));
  const previousDirectory = process.cwd();
  let prisma;
  try {
    process.chdir(directory);
    writeFileSync('schema.prisma', `generator client {
  provider = "prisma-client-js"
  output   = "client"
}
datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}
model Widget {
  id   Int    @id @default(autoincrement())
  name String
}
`);
    process.env.PRISMA_SCHEMA_ENGINE_BINARY = engines.schemaEngineBinaryPath;
    process.env.PRISMA_QUERY_ENGINE_LIBRARY = engines.queryEngineLibraryPath;
    run('npx', ['--yes', `prisma@${version}`, 'db', 'push', '--schema', 'schema.prisma', '--skip-generate']);
    run('npx', ['--yes', `prisma@${version}`, 'generate', '--schema', 'schema.prisma']);
    const { PrismaClient } = requirePackage(join(directory, 'client'));
    prisma = new PrismaClient();
    const widget = await prisma.widget.create({ data: { name: 'smoke-test' } });
    assert.equal(widget.name, 'smoke-test');
    const found = await prisma.widget.findUnique({ where: { id: widget.id } });
    assert.equal(found?.name, 'smoke-test', 'read-back failed');
    return {
      result: { commit, compatibility: true, row: found.name, roundTrip: true },
      assets: [],
    };
  } finally {
    try {
      if (prisma) await prisma.$disconnect();
    } finally {
      process.chdir(previousDirectory);
      rmSync(directory, { recursive: true, force: true });
    }
  }
}
