import assert from 'node:assert/strict';

export default async function test({ importPackage }) {
  const { generate } = await importPackage('yuku-codegen');
  const ast = {
    type: 'Program',
    sourceType: 'module',
    start: 0,
    end: 6,
    body: [{
      type: 'ExpressionStatement',
      start: 0,
      end: 6,
      expression: {
        type: 'BinaryExpression',
        operator: '+',
        start: 0,
        end: 5,
        left: { type: 'Literal', value: 1, start: 0, end: 1 },
        right: { type: 'Literal', value: 2, start: 4, end: 5 },
      },
    }],
  };
  const pretty = generate(ast);
  assert.equal(pretty.code, '1 + 2;');
  assert.deepEqual(pretty.diagnostics, []);
  assert.equal(pretty.map, null);
  const compact = generate(ast, { minify: true });
  assert.equal(compact.code, '1+2');
  const mapped = generate(ast, { sourceMap: { source: '1 + 2;', file: 'out.js', sourceFileName: 'in.js' } });
  assert.equal(mapped.code, '1 + 2;');
  assert.equal(mapped.map.version, 3);
  assert.equal(mapped.map.file, 'out.js');
  assert.deepEqual(mapped.map.sources, ['in.js']);
  assert.ok(mapped.map.mappings.length > 0);
  return { result: { format: true, minify: true, sourceMap: true }, assets: [] };
}
