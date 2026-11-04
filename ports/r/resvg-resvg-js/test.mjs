import assert from 'node:assert/strict';

export default function test({ requirePackage }) {
  const { Resvg } = requirePackage('@resvg/resvg-js');
  const svg = '<svg width="100" height="50" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="10" width="30" height="20" fill="red"/></svg>';
  const resvg = new Resvg(svg);
  const bbox = resvg.innerBBox();
  assert.deepEqual({ x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height }, { x: 10, y: 10, width: 30, height: 20 });
  const rendered = resvg.render();
  const png = rendered.asPng();
  assert.ok(png.length > 8);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return { result: { boundingBox: true, pngRender: true }, assets: [] };
}
