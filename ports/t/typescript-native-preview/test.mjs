import assert from 'node:assert/strict';

export default async function test({ helper }) {
  const tools = await import(helper);
  tools.cli('@typescript/native-preview', ['--version'], {}, 'tsgo');
  tools.write('tsconfig.json', JSON.stringify({ compilerOptions: { strict: true } }));
  tools.write('bad.ts', 'const n: number = "x";\n');
  const result = tools.cli('@typescript/native-preview', ['--noEmit', '-p', 'tsconfig.json'], { codes: [0, 1, 2] }, 'tsgo');
  assert.match(result.output, /error TS2322/);
  return { result: { version: true, typeError: 'TS2322' }, assets: [] };
}
