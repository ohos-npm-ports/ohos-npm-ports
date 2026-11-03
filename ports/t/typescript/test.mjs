import assert from 'node:assert/strict';

export default async function test({ helper }) {
  const tools = await import(helper);
  tools.cli('typescript', ['--version'], {}, 'tsc');
  tools.write('tsconfig.json', JSON.stringify({ compilerOptions: { strict: true } }));
  tools.write('bad.ts', 'const n: number = "x";\n');
  const result = tools.cli('typescript', ['--noEmit', '-p', 'tsconfig.json'], { codes: [0, 1, 2] }, 'tsc');
  assert.match(result.output, /error TS/);
  return { result: { version: true, typeError: true }, assets: [] };
}
