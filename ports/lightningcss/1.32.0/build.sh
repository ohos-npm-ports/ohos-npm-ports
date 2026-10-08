#!/bin/sh
set -e

VERSION=1.32.0
PKG=lightningcss
SHA256=ca67b9ba532d439f5f91d23debfc2543d6decac130ee88bc4c66202fc7173ad9

curl -fsSL "https://github.com/parcel-bundler/lightningcss/archive/refs/tags/v${VERSION}.tar.gz" -o "${PKG}.tar.gz"
printf '%s  %s\n' "$SHA256" "${PKG}.tar.gz" | sha256sum -c -
rm -rf "${PKG}-${VERSION}"
tar -zxf "${PKG}.tar.gz"
rm "${PKG}.tar.gz"

cd "${PKG}-${VERSION}"
find . -type f -exec sha256sum {} + | sort > /tmp/lightningcss-1.32.0-before.sha256
patch -p1 < ../patchs/0001-update-package-json.patch
patch -p1 < ../patchs/0002-openharmony-loader.patch
python3 - <<'PY'
import hashlib
from pathlib import Path

before = {}
for line in Path('/tmp/lightningcss-1.32.0-before.sha256').read_text().splitlines():
    digest, path = line.split('  ', 1)
    before[path.removeprefix('./')] = digest
allowed = {'package.json', 'node/index.js'}
after = {}
for path in Path('.').rglob('*'):
    if path.is_file():
        key = str(path)
        after[key] = hashlib.sha256(path.read_bytes()).hexdigest()
changed = {path for path in before.keys() | after.keys() if before.get(path) != after.get(path)}
if not changed <= allowed:
    raise SystemExit(f'patches changed unexpected files: {sorted(changed - allowed)}')
if changed != allowed:
    raise SystemExit(f'expected package.json and node/index.js changes, got: {sorted(changed)}')
PY

grep -q "process.platform === 'openharmony'" node/index.js
brew install -y rust
export PATH="$(brew --prefix rust)/bin:$PATH"
npm install --ignore-scripts --no-package-lock --no-audit --no-fund
export PATH="$(pwd)/node_modules/.bin:$PATH"
export CARGO_TARGET_DIR=/root/.cache/lightningcss-1.32.0-target
node scripts/build.js --release

test -f lightningcss.linux-arm64-ohos.node
llvm-strip --strip-all lightningcss.linux-arm64-ohos.node
binary-sign-tool sign -selfSign 1 -inFile lightningcss.linux-arm64-ohos.node -outFile lightningcss.linux-arm64-ohos.node.signed
mv lightningcss.linux-arm64-ohos.node.signed lightningcss.linux-arm64-ohos.node
chmod +x lightningcss.linux-arm64-ohos.node

NAME=$(node -e "console.log(require('./package.json').name)")
[ "$NAME" = '@ohos-npm-ports/lightningcss' ]
VERSION_BUILT=$(node -e "console.log(require('./package.json').version)")
[ "$VERSION_BUILT" = '1.32.0-1' ]
node -e '
  const pkg = require("./package.json");
  const base = pkg.version.replace(/-.*$/, "");
  for (const [name, version] of Object.entries(pkg.optionalDependencies ?? {})) {
    if (name.startsWith("lightningcss-") && version !== base) {
      throw new Error(`${name} has ${version}, expected ${base}`);
    }
  }
'
node --check node/index.js
grep -q "process.platform === 'openharmony'" node/index.js
readelf -h lightningcss.linux-arm64-ohos.node | grep -q 'AArch64'
readelf -S lightningcss.linux-arm64-ohos.node | grep -q '\.codesign'
node - <<'JS'
const Module = require('module');
const load = Module._load;
const cases = [
  ['linux', 'lightningcss-linux-arm64-gnu'],
  ['darwin', 'lightningcss-darwin-arm64'],
  ['win32', 'lightningcss-win32-arm64-msvc'],
];
for (const [platform, expected] of cases) {
  Object.defineProperty(process, 'platform', { configurable: true, value: platform });
  let selected;
  Module._load = function (request, parent, isMain) {
    if (request === 'detect-libc') return { MUSL: 'musl', familySync: () => 'glibc' };
    if (request.startsWith('lightningcss-')) {
      selected = request;
      return {};
    }
    return load.call(this, request, parent, isMain);
  };
  delete require.cache[require.resolve('./node/index.js')];
  require('./node/index.js');
  if (selected !== expected) throw new Error(`${platform} selected ${selected}, expected ${expected}`);
}
Module._load = load;
Object.defineProperty(process, 'platform', { configurable: true, value: 'openharmony' });
delete require.cache[require.resolve('./node/index.js')];
const { transform } = require('./node/index.js');
const { code } = transform({ filename: 'test.css', code: Buffer.from('.a { color: red }'), minify: true });
const output = code.toString();
console.log('transform() output:', output);
if (!output.includes('.a') || !output.includes('red')) throw new Error('unexpected transform output');
JS

mkdir -p /tmp/lightningcss-consumer
npm pack --pack-destination /tmp/lightningcss-consumer
mkdir -p /tmp/lightningcss-consumer/project
cd /tmp/lightningcss-consumer/project
npm install --no-audit --no-fund /tmp/lightningcss-consumer/ohos-npm-ports-lightningcss-1.32.0-1.tgz
node - <<'JS'
const { transform } = require('@ohos-npm-ports/lightningcss');
const { code } = transform({ filename: 'consumer.css', code: Buffer.from('.consumer { color: red }'), minify: true });
const output = code.toString();
console.log('packed consumer transform() output:', output);
if (!output.includes('.consumer') || !output.includes('red')) throw new Error('packed consumer transform failed');
JS
