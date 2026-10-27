#!/bin/sh
set -e
WORK_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BUILD_DIR="$WORK_DIR/.build"
PACKAGE_DIR="$WORK_DIR/testcafe-3.7.6"
export npm_config_registry=https://registry.npmjs.org
export OPENSSL_CONF=/dev/null

do_fetch() {
    mkdir -p "$BUILD_DIR"
    curl -fL --retry 3 https://registry.npmjs.org/testcafe/-/testcafe-3.7.6.tgz -o "$BUILD_DIR/upstream.tgz"
    echo "e0870553529a88d5cb77e0b1cc4981406edbe52187daec50b673c91d7c4f6ce1  $BUILD_DIR/upstream.tgz" | sha256sum -c -
    rm -rf "$BUILD_DIR/package"
    tar -xzf "$BUILD_DIR/upstream.tgz" -C "$BUILD_DIR"
    node - "$BUILD_DIR/package" "$BUILD_DIR/upstream-hashes.json" <<'JS'
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=process.argv[2],hashes={};
function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,item.name);if(item.isDirectory())walk(p);else hashes[path.relative(root,p)]=crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');}}
walk(root);fs.writeFileSync(process.argv[3],JSON.stringify(hashes));
JS
}

do_build() {
    cd "$BUILD_DIR/package"
    for patch_file in "$WORK_DIR"/patchs/*.patch; do patch -p1 < "$patch_file"; done
    grep -q "process.platform === 'openharmony'" lib/browser/provider/built-in/index.js
    grep -q 'generateThumbnail' lib/ohos/thumbnail.cjs
    grep -q 'supportMultipleWindows:true' lib/ohos/provider.cjs
    node - "$BUILD_DIR/package" "$BUILD_DIR/upstream-hashes.json" <<'JS'
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=process.argv[2],before=JSON.parse(fs.readFileSync(process.argv[3]));
const allowed=new Set(['package.json','lib/browser/provider/built-in/index.js','lib/screenshots/capturer.js']);
for(const [file,hash] of Object.entries(before)){const current=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');if(!allowed.has(file))assert.equal(current,hash,file);}
function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,item.name);if(item.isDirectory())walk(p);else {const rel=path.relative(root,p);assert.ok(rel in before||rel.startsWith('lib/ohos/'),rel);}}}
walk(root);
JS
}

do_package() {
    rm -rf "$PACKAGE_DIR"
    mv "$BUILD_DIR/package" "$PACKAGE_DIR"
    cd "$PACKAGE_DIR"
    npm pack --ignore-scripts --pack-destination "$BUILD_DIR"
}

do_test() {
    rm -rf "$BUILD_DIR/consumer"
    mkdir -p "$BUILD_DIR/consumer"
    node - "$BUILD_DIR" <<'JS'
const fs=require('node:fs'),path=require('node:path');const root=process.argv[2];fs.writeFileSync(path.join(root,'consumer/package.json'),JSON.stringify({private:true,dependencies:{testcafe:`file:${path.join(root,'ohos-npm-ports-testcafe-3.7.6-1.tgz')}`}}));
JS
    cd "$BUILD_DIR/consumer"
    npm install --ignore-scripts --no-audit --no-fund
    export TESTCAFE_PACKAGE="$BUILD_DIR/consumer/node_modules/testcafe"
    export NODE_PATH="$BUILD_DIR/consumer/node_modules"
    node - "$TESTCAFE_PACKAGE" <<'JS'
const assert=require('node:assert/strict'),path=require('node:path');const root=process.argv[2],p=require(path.join(root,'package.json'));
assert.equal(p.name,'@ohos-npm-ports/testcafe');assert.equal(p.version,'3.7.6-1');assert.equal(typeof require(root),'function');
JS
    PORT_TEST_REPORT="$BUILD_DIR/consumer-report.json" node "$WORK_DIR/test.js"
    node "$WORK_DIR/tests/platforms.cjs"
    node --test "$WORK_DIR"/tests/*.test.cjs "$WORK_DIR"/tests/*.test.mjs
    node -e "const assert=require('node:assert/strict');assert.equal(require('testcafe/package.json').version,'3.7.6-1');assert.equal(typeof require('testcafe'),'function')"
    node node_modules/testcafe/bin/testcafe.js --version
}

do_fetch
do_build
do_package
do_test
