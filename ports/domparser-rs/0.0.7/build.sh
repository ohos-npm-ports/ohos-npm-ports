#!/bin/sh
set -e
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BUILD_DIR=${BUILD_DIR:-"$ROOT/build"}
SOURCE="$BUILD_DIR/source"
PACKAGE="$ROOT/domparser-rs-0.0.7"

do_deps() {
    export PATH="$(brew --prefix rust)/bin:$PATH"
    command -v cargo >/dev/null
    command -v binary-sign-tool >/dev/null
    [ "$(rustc -vV | sed -n 's/^host: //p')" = aarch64-unknown-linux-ohos ]
}

do_fetch() {
    mkdir -p "$BUILD_DIR"
    curl -fsSL --retry 5 https://codeload.github.com/utooland/domparser-rs/tar.gz/79e32cd0ae4902a907a91b9c079c3de1f152db95 -o "$BUILD_DIR/source.tgz"
    echo "cea5f6328b4db383de21aed329d6500eba5fa5537725242903705410584e773b  $BUILD_DIR/source.tgz" | sha256sum -c -
    curl -fsSL --retry 5 https://registry.npmjs.org/domparser-rs/-/domparser-rs-0.0.7.tgz -o "$BUILD_DIR/package.tgz"
    echo "fef9487622af8ccc1e4fdc60e1795fde5ad84766d3dd253e601d648a8fa5dc5e  $BUILD_DIR/package.tgz" | sha256sum -c -
    rm -rf "$SOURCE" "$PACKAGE" "$BUILD_DIR/upstream"
    mkdir -p "$SOURCE" "$PACKAGE" "$BUILD_DIR/upstream"
    tar xzf "$BUILD_DIR/source.tgz" -C "$SOURCE" --strip-components=1
    tar xzf "$BUILD_DIR/package.tgz" -C "$BUILD_DIR/upstream" --strip-components=1
    cp -R "$BUILD_DIR/upstream/." "$PACKAGE/"
}

do_build() {
    cd "$SOURCE"
    export CARGO_TARGET_DIR="$BUILD_DIR/target"
    cargo build --locked --release -p domparser_napi -j "${CARGO_BUILD_JOBS:-2}"
}

do_package() {
    cd "$PACKAGE"
    patch -p1 < "$ROOT/patchs/0001-package-json.patch"
    grep -q '@ohos-npm-ports/domparser-rs' package.json
    cp "$BUILD_DIR/target/release/libdomparser_napi.so" domparser.openharmony-arm64.node
    binary-sign-tool sign -selfSign 1 -inFile domparser.openharmony-arm64.node -outFile "$BUILD_DIR/signed.node"
    mv "$BUILD_DIR/signed.node" domparser.openharmony-arm64.node
}

do_test() {
    readelf -h "$PACKAGE/domparser.openharmony-arm64.node" | grep -q AArch64
    readelf -S "$PACKAGE/domparser.openharmony-arm64.node" | grep -q '\.codesign'
    grep -q "process.platform === 'openharmony'" "$PACKAGE/index.js"
    node "$ROOT/verify.cjs" "$PACKAGE" "$BUILD_DIR/upstream"
    cd "$PACKAGE"
    npm pack --ignore-scripts --pack-destination "$BUILD_DIR"
    mkdir -p "$BUILD_DIR/packed"
    tar xzf "$BUILD_DIR/ohos-npm-ports-domparser-rs-0.0.7-1.tgz" -C "$BUILD_DIR/packed"
    test -s "$BUILD_DIR/packed/package/domparser.openharmony-arm64.node"
}

do_deps
do_fetch
do_build
do_package
do_test
