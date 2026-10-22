#!/bin/sh
set -e

WORK_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
BUILD_DIR="$WORK_DIR/build"
VERSION=0.18.0-ts7.1.0-dev.20260929
PORT_VERSION="$VERSION-1"
export VERSION PORT_VERSION BUILD_DIR

fetch() {
    url=$1
    output=$2
    digest=$3
    if [ ! -f "$output" ]; then
        curl -fL --retry 3 --connect-timeout 30 "$url" -o "$output"
    fi
    echo "$digest  $output" | sha256sum -c -
}

do_deps() {
    for dependency in cmake openssl@3 zlib-ng-compat libxml2; do
        brew list --versions "$dependency" >/dev/null 2>&1 || brew install -y "$dependency"
    done
    mkdir -p "$BUILD_DIR"
    fetch https://static.rust-lang.org/dist/rust-1.99.1-aarch64-unknown-linux-ohos.tar.xz \
        "$BUILD_DIR/rust.tar.xz" 4b078f77667e497d93f850c0f91ffbb39b764c3e51a2229db9de3f5b595385a3
    if [ ! -x "$BUILD_DIR/rust/bin/rustc" ]; then
        tar -xJf "$BUILD_DIR/rust.tar.xz" -C "$BUILD_DIR"
        sh "$BUILD_DIR/rust-1.99.1-aarch64-unknown-linux-ohos/install.sh" \
            --prefix="$BUILD_DIR/rust" --disable-ldconfig \
            --components=rustc,cargo,rust-std-aarch64-unknown-linux-ohos
    fi
    export PATH="$BUILD_DIR/rust/bin:$PATH"
    export LD_LIBRARY_PATH="$(brew --prefix openssl@3)/lib:$(brew --prefix zlib-ng-compat)/lib:$(brew --prefix libxml2)/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
    export CARGO_HTTP_CAINFO="$(brew --prefix)/etc/openssl@3/cert.pem"
    rustc --version
}

do_fetch() {
    fetch https://codeload.github.com/oxc-project/tsrs/tar.gz/refs/tags/v0.18.0 \
        "$BUILD_DIR/source.tar.gz" d9a08890fb9b60442e4ae1a9a90b987daef7f3429afb2153cf8ebff635f7fcd6
    fetch "https://registry.npmjs.org/tsrs/-/tsrs-$VERSION.tgz" \
        "$BUILD_DIR/npm.tgz" 8a07eaa884fc4841b856dbad44eee825c0b9ed7c607c35ef74c7a0223d98ba18
    if [ ! -d "$BUILD_DIR/tsrs-0.18.0" ]; then
        tar -xzf "$BUILD_DIR/source.tar.gz" -C "$BUILD_DIR"
    fi
}

do_build() {
    (cd "$BUILD_DIR/tsrs-0.18.0" && cargo test --locked -p tsrs_core --features plain-ptrs --lib)
    # HarmonyOS cannot reserve the default compressed-pointer arena address.
    (cd "$BUILD_DIR/tsrs-0.18.0" && cargo build --release --locked -p tsrs_cli --features noembed,tsrs_core/plain-ptrs)
}

do_package() {
    rm -rf "$BUILD_DIR/main" "$BUILD_DIR/native"
    mkdir -p "$BUILD_DIR/main" "$BUILD_DIR/native"
    tar -xzf "$BUILD_DIR/npm.tgz" -C "$BUILD_DIR/main" --strip-components=1
    cp "$BUILD_DIR/tsrs-0.18.0/target/release/tsrs" "$BUILD_DIR/native/tsrs"
    cp "$BUILD_DIR/tsrs-0.18.0/crates/tsrs_vfs/libs/"*.d.ts "$BUILD_DIR/native/"
    cp "$BUILD_DIR/tsrs-0.18.0/LICENSE" "$BUILD_DIR/tsrs-0.18.0/NOTICE" "$BUILD_DIR/native/"
    binary-sign-tool sign -selfSign 1 -inFile "$BUILD_DIR/native/tsrs" -outFile "$BUILD_DIR/native/tsrs"
    chmod +x "$BUILD_DIR/native/tsrs"
    node --input-type=module <<'JS'
import fs from 'node:fs';
const {BUILD_DIR: root, PORT_VERSION: version} = process.env;
const file = `${root}/main/package.json`;
const pkg = JSON.parse(fs.readFileSync(file));
pkg.name = '@ohos-npm-ports/tsrs';
pkg.version = version;
pkg.repository = {type:'git', url:'git+https://github.com/ohos-npm-ports/ohos-npm-ports.git'};
pkg.optionalDependencies['@tsrs/openharmony-arm64'] = `npm:@ohos-npm-ports/tsrs-openharmony-arm64@${version}`;
fs.writeFileSync(file, JSON.stringify(pkg, null, 2)+'\n');
fs.writeFileSync(`${root}/native/package.json`, JSON.stringify({
 name:'@ohos-npm-ports/tsrs-openharmony-arm64', version,
 license:pkg.license, repository:pkg.repository, os:['openharmony'], cpu:['arm64'],
 exports:{'./package.json':'./package.json'}, files:['tsrs','*.d.ts','LICENSE','NOTICE'],
},null,2)+'\n');
JS
}

do_test() {
    readelf -h "$BUILD_DIR/native/tsrs" | grep -q AArch64
    readelf -S "$BUILD_DIR/native/tsrs" | grep -q '\.codesign'
    node --input-type=module <<'JS'
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const root=process.env.BUILD_DIR;
fs.mkdirSync(`${root}/original`, {recursive:true});
execFileSync('tar',['-xzf',`${root}/npm.tgz`,'-C',`${root}/original`,'--strip-components=1']);
function walk(dir, prefix='') {
 for (const e of fs.readdirSync(dir,{withFileTypes:true})) {
  const name=prefix+e.name;
  if(e.isDirectory()) walk(`${dir}/${e.name}`,name+'/');
  else if(name!=='package.json') assert.deepEqual(fs.readFileSync(`${dir}/${e.name}`),fs.readFileSync(`${root}/main/${name}`),name);
 }
}
walk(`${root}/original`);
const old=JSON.parse(fs.readFileSync(`${root}/original/package.json`));
const pkg=JSON.parse(fs.readFileSync(`${root}/main/package.json`));
for(const [name,v] of Object.entries(old.optionalDependencies)) assert.equal(pkg.optionalDependencies[name],v);
for(const k of ['name','version','repository','optionalDependencies']) {delete old[k];delete pkg[k];}
assert.deepEqual(pkg,old);
JS
    (cd "$BUILD_DIR/native" && npm pack --pack-destination "$BUILD_DIR")
    (cd "$BUILD_DIR/main" && npm pack --pack-destination "$BUILD_DIR")
    rm -rf "$BUILD_DIR/consumer"
    mkdir -p "$BUILD_DIR/consumer"
    (cd "$BUILD_DIR/consumer" && npm init -y && npm install --force --ignore-scripts --omit=optional \
        "tsrs@file:$BUILD_DIR/ohos-npm-ports-tsrs-$PORT_VERSION.tgz" \
        "@tsrs/openharmony-arm64@file:$BUILD_DIR/ohos-npm-ports-tsrs-openharmony-arm64-$PORT_VERSION.tgz")
    node "$WORK_DIR/smoke.mjs" "$BUILD_DIR/consumer"
    cp "$BUILD_DIR/tsrs-0.18.0/npm/sdk/smoke/consumer.mjs" "$BUILD_DIR/consumer/upstream-smoke.mjs"
    (cd "$BUILD_DIR/consumer" && timeout 180 node upstream-smoke.mjs "$BUILD_DIR/consumer/api-fixture")
}

do_deps
do_fetch
do_build
do_package
do_test
