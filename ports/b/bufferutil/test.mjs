import assert from 'node:assert/strict';

export default function test({ requirePackage }) {
  const bufferutil = requirePackage('bufferutil');
  const source = Buffer.from('OpenHarmony');
  const key = Buffer.from([1, 2, 3, 4]);
  const masked = Buffer.alloc(source.length);
  bufferutil.mask(source, key, masked, 0, source.length);
  assert.notDeepEqual(masked, source);
  bufferutil.unmask(masked, key);
  assert.deepEqual(masked, source);
  return { result: { maskRoundTrip: true }, assets: [] };
}
