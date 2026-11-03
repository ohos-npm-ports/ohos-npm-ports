import assert from 'node:assert/strict';

export default async function test({ helper }) {
  const tools = await import(helper);
  tools.write('tsconfig.json', JSON.stringify({ compilerOptions: { strict: true } }));
  tools.write('bad.ts', 'const n = 1 as unknown as string | undefined;\n');
  const result = tools.cli('oxlint-tsgolint', ['-tsconfig', 'tsconfig.json', 'bad.ts'], { codes: [0, 1, 2] }, 'tsgolint');
  assert.match(result.output, /no-unsafe-type-assertion/);
  return { result: { diagnostic: 'no-unsafe-type-assertion' }, assets: [] };
}
