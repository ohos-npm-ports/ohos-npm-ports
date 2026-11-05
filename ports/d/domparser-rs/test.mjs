import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

function verifyPlatformLoaders(root) {
  const source = readFileSync(resolve(root, 'index.js'), 'utf8');
  for (const [platform, arch, musl, expected] of [
    ['openharmony', 'arm64', false, './domparser.openharmony-arm64.node'],
    ['linux', 'arm64', false, 'domparser-linux-arm64-gnu'],
    ['linux', 'arm64', true, 'domparser-linux-arm64-musl'],
    ['darwin', 'arm64', false, 'domparser-darwin-arm64'],
    ['win32', 'x64', false, 'domparser-win32-x64-msvc'],
  ]) {
    const native = { NodeRepr: class {}, parse() {} };
    let selected;
    const module = { exports: {} };
    runInNewContext(source, {
      process: { platform, arch, env: {} }, module, exports: module.exports,
      require(id) {
        if (id === 'fs' || id === 'node:fs') return { readFileSync() { return musl ? 'musl' : 'glibc'; } };
        if (id === expected) { selected = id; return native; }
        if (id === `${expected}/package.json`) return { version: '0.0.7' };
        throw new Error(`not installed: ${id}`);
      },
    });
    assert.equal(selected, expected, `${platform}/${arch}/${musl ? 'musl' : 'glibc'}`);
    assert.equal(module.exports, native);
  }
}

export default function test({ requirePackage, resolvePackage, mode, version, revision }) {
  verifyPlatformLoaders(dirname(resolvePackage('domparser-rs/package.json')));
  const { DOMParser, parse } = requirePackage('domparser-rs');
  const pkg = requirePackage('domparser-rs/package.json');
  if (mode !== 'baseline') {
    assert.equal(pkg.name, '@ohos-npm-ports/domparser-rs');
    assert.equal(pkg.version, `${version}-${revision}`);
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
  return {
    result: {
      text: node.textContent,
      className: node.getAttribute('class'),
      attribute: node.getAttribute('data-port'),
      missingSelector: true,
      directParse: true,
      unsupportedMimeRejected: true,
    },
    assets: [],
  };
}
