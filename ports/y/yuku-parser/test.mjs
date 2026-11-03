import assert from 'node:assert/strict';

export default async function test({ importPackage }) {
  const { parse, TokenKind } = await importPackage('yuku-parser');
  const result = parse('const answer: number = 40 + 2;', { path: 'sample.ts' });
  const declaration = result.program?.body?.[0];
  assert.equal(result.program?.type, 'Program');
  assert.equal(declaration?.type, 'VariableDeclaration');
  assert.equal(declaration.kind, 'const');
  assert.equal(result.diagnostics.length, 0);
  assert.notEqual(TokenKind.Const, undefined);
  return {
    result: { program: result.program.type, declaration: declaration.type, kind: declaration.kind, diagnostics: 0, tokenKind: true },
    assets: [],
  };
}
