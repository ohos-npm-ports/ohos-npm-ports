import assert from 'node:assert/strict';

export default function test({ requirePackage }) {
  const { transform } = requirePackage('lightningcss');
  const source = '.app { color: #ff0000; margin: 0px 0px 0px 0px; user-select: none; }';
  const transformed = transform({
    filename: 'input.css',
    code: Buffer.from(source),
    minify: true,
    sourceMap: true,
    targets: { safari: 12 << 16 },
  });
  const css = transformed.code.toString();
  assert.match(css, /color:red/);
  assert.match(css, /margin:0/);
  assert.match(css, /-webkit-user-select:none/);
  const map = JSON.parse(transformed.map.toString());
  assert.equal(map.version, 3);
  assert.deepEqual(map.sources, ['input.css']);
  assert.deepEqual(map.sourcesContent, [source]);
  return { result: { css, sourceMap: true }, assets: [] };
}
