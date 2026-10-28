#!/bin/sh
set -e
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BUILD_DIR=${BUILD_DIR:-"$ROOT/build"}
SOURCE="$BUILD_DIR/source"
PACKAGE="$ROOT/utoo-pack-1.5.31"

do_deps() {
    export PATH="$(brew --prefix rust)/bin:$PATH"
    command -v cmake >/dev/null || brew install -y cmake
    command -v pkgconf >/dev/null || brew install -y pkgconf
    command -v binary-sign-tool >/dev/null
    [ "$(rustc -vV | sed -n 's/^host: //p')" = aarch64-unknown-linux-ohos ]
}

do_fetch() {
    mkdir -p "$BUILD_DIR"
    curl -fsSL --retry 5 https://codeload.github.com/utooland/utoo/tar.gz/0e838fbfa1105d68dfdd2c1fc4f79fb1c1feebbd -o "$BUILD_DIR/source.tgz"
    echo "28f208e1280fc01aa05d8ec5663b7ced5a6907da44c7361cb5be6a818a7d9c64  $BUILD_DIR/source.tgz" | sha256sum -c -
    curl -fsSL --retry 5 https://codeload.github.com/utooland/next.js/tar.gz/815238d6a4a18958c43a6875a86026d20a424dac -o "$BUILD_DIR/next.tgz"
    echo "30c63a6c41d7a945f2121e8300c739e992c28dc246cfbde4d2fa913ba395d336  $BUILD_DIR/next.tgz" | sha256sum -c -
    curl -fsSL --retry 5 https://registry.npmjs.org/@utoo/pack/-/pack-1.5.31.tgz -o "$BUILD_DIR/package.tgz"
    echo "d7f1a2442bc65259f791dbb625c4a4a63a20bba39e2969ea9fa05a6b95559dcb  $BUILD_DIR/package.tgz" | sha256sum -c -
    rm -rf "$SOURCE" "$PACKAGE" "$BUILD_DIR/upstream"
    mkdir -p "$SOURCE" "$PACKAGE" "$BUILD_DIR/upstream"
    tar xzf "$BUILD_DIR/source.tgz" -C "$SOURCE" --strip-components=1
    tar xzf "$BUILD_DIR/next.tgz" -C "$SOURCE/next.js" --strip-components=1 \
        --exclude='*/test' --exclude='*/examples' --exclude='*/.claude'
    tar xzf "$BUILD_DIR/package.tgz" -C "$BUILD_DIR/upstream" --strip-components=1
    cp -R "$BUILD_DIR/upstream/." "$PACKAGE/"
}

do_build() {
    cd "$SOURCE"
    export RUSTC_BOOTSTRAP=1
    export CARGO_TARGET_DIR="$BUILD_DIR/target"
    export CARGO_PROFILE_RELEASE_LTO=false
    export VERGEN_GIT_SHA=0e838fbfa1105d68dfdd2c1fc4f79fb1c1feebbd
    export VERGEN_GIT_DIRTY=false
    export CC=cc CXX=c++
    cargo build --locked --release -p pack-napi --features plugin -j "${CARGO_BUILD_JOBS:-2}"
}

do_package() {
    cd "$PACKAGE"
    patch -p1 < "$ROOT/patchs/0001-package-json.patch"
    patch -p1 < "$ROOT/patchs/0002-share-openharmony-binding.patch"
    grep -q '@ohos-npm-ports/utoo-pack' package.json
    grep -q '../cjs/pack.openharmony-arm64.node' esm/binding.js
    cp "$SOURCE/LICENSE" LICENSE
    cp "$SOURCE/next.js/license.md" cjs/LICENSE-turbopack
    cp "$BUILD_DIR/target/release/libpack_napi.so" cjs/pack.openharmony-arm64.node
    binary-sign-tool sign -selfSign 1 -inFile cjs/pack.openharmony-arm64.node -outFile "$BUILD_DIR/signed.node"
    mv "$BUILD_DIR/signed.node" cjs/pack.openharmony-arm64.node
}

do_test() {
    cmp "$SOURCE/LICENSE" "$PACKAGE/LICENSE"
    cmp "$SOURCE/next.js/license.md" "$PACKAGE/cjs/LICENSE-turbopack"
    readelf -h "$PACKAGE/cjs/pack.openharmony-arm64.node" | grep -q AArch64
    readelf -S "$PACKAGE/cjs/pack.openharmony-arm64.node" | grep -q '\.codesign'
    grep -q "process.platform === 'openharmony'" "$PACKAGE/cjs/binding.js"
    node "$ROOT/verify.cjs" "$PACKAGE" "$BUILD_DIR/upstream"
    cd "$PACKAGE"
    npm pack --ignore-scripts --pack-destination "$BUILD_DIR"
    mkdir -p "$BUILD_DIR/packed"
    tar xzf "$BUILD_DIR/ohos-npm-ports-utoo-pack-1.5.31-1.tgz" -C "$BUILD_DIR/packed"
    test -s "$BUILD_DIR/packed/package/cjs/pack.openharmony-arm64.node"
}

do_deps
do_fetch
do_build
do_package
do_test
