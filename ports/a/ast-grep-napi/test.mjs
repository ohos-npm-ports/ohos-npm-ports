import assert from 'node:assert/strict';

export default function test({ requirePackage }) {
  const { parse, Lang } = requirePackage('@ast-grep/napi');
  const root = parse(Lang.JavaScript, 'const answer = 40 + 2;').root();
  const match = root.find('const $NAME = $A + $B');
  assert.ok(match);
  assert.equal(match.getMatch('NAME').text(), 'answer');
  assert.equal(match.getMatch('A').text(), '40');
  assert.equal(match.getMatch('B').text(), '2');
  return { result: { parse: true, patternMatch: true }, assets: [] };
}
