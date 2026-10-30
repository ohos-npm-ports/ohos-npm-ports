// @test-package: lightningcss
// @test-format: cjs
const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');
const { transform } = require('lightningcss');

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
assert.ok(css.length < source.length + '-webkit-user-select:none;'.length);
const map = JSON.parse(transformed.map.toString());
assert.equal(map.version, 3);
assert.deepEqual(map.sources, ['input.css']);
assert.deepEqual(map.sourcesContent, [source]);
assert.ok(map.mappings.length > 0);

const modules = transform({
  filename: 'module.css',
  code: Buffer.from('.button { color: blue } .active { composes: button; color: red }'),
  cssModules: { pattern: '[name]_[local]' },
  minify: true,
});
assert.equal(modules.exports.button.name, 'module_button');
assert.equal(modules.exports.active.name, 'module_active');
assert.deepEqual(modules.exports.active.composes, [{ type: 'local', name: 'module_button' }]);
const moduleCss = modules.code.toString();
assert.match(moduleCss, /\.module_button\{/);
assert.match(moduleCss, /\.module_active\{/);
assert.throws(() => transform({
  filename: 'invalid.css', code: Buffer.from('.broken[ { color: red }'),
  errorRecovery: false,
}));

writeFileSync(process.env.PORT_TEST_REPORT, JSON.stringify({
  result: { css, map, moduleCss, exports: modules.exports, invalidCssRejected: true },
  assets: [],
}));
