// @test-package: domparser-rs
// @test-format: cjs
const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');
const { DOMParser, parse } = require('domparser-rs');
const pkg = require('domparser-rs/package.json');
if (process.env.PORT_TEST_MODE === 'overrides') {
  assert.equal(pkg.name, '@ohos-npm-ports/domparser-rs');
  assert.equal(pkg.version, '0.0.7-1');
}
const parser = new DOMParser();
const doc = parser.parseFromString('<html><body><p id="proof" class="a">native &amp; DOM</p></body></html>', 'text/html');
const node = doc.querySelector('#proof');
assert.equal(node.textContent, 'native & DOM');
assert.equal(doc.querySelector('#missing'), null);
node.classList.add('verified');
assert(node.classList.contains('verified'));
node.classList.remove('a');
assert(!node.classList.contains('a'));
assert.equal(node.classList.toggle('temporary'), true);
assert.equal(node.classList.toggle('temporary'), false);
node.setAttribute('data-port', 'source-built');
assert.equal(node.getAttribute('data-port'), 'source-built');
assert.equal(parse('<section><b>parsed</b></section>').querySelector('b').textContent, 'parsed');
assert.throws(() => parser.parseFromString('<x/>', 'application/xml'), /Unsupported mime type/);
writeFileSync(process.env.PORT_TEST_REPORT, JSON.stringify({
  result: { text: node.textContent, className: node.getAttribute('class'), attribute: node.getAttribute('data-port'), missingSelector: true, directParse: true, unsupportedMimeRejected: true },
  assets: [],
}));
