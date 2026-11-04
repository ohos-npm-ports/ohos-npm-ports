import assert from 'node:assert/strict';

export default function test({ requirePackage }) {
  const { Scanner } = requirePackage('@tailwindcss/oxide');
  const scanner = new Scanner({ sources: [] });
  const candidates = scanner.scanFiles([
    { content: '<div class="text-red-500 flex"></div>', extension: 'html' },
  ]).sort();
  assert.deepEqual(candidates, ['class', 'flex', 'text-red-500']);
  return { result: { candidates }, assets: [] };
}
