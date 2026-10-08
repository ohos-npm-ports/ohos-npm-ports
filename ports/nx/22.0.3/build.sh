#!/bin/sh
set -e

PKG=nx
VERSION=22.0.3
PORTS_VERSION=22.0.3-1
SOURCE_REV=154fbd06269f0c7ee57e8c9aa73fec2d07425e16
TUI_REV=88e3b61425c97220c528ef76c188df10032a75dd
VT100_REV=b15dc3b0f7db94167a9c584f1d403899c0cc871d
WEZTERM_REV=b538ee29e1e89eeb4832fb35ae095564dce34c29
WORK_DIR=$(pwd)
BUILD_DIR="$WORK_DIR/build"
SRC="$BUILD_DIR/src"
GITDEPS="$BUILD_DIR/gitdeps"
PKG_DIR="$BUILD_DIR/$PKG-$VERSION"

download() {
    curl -fsSL --retry 5 --retry-all-errors --retry-delay 5 "$1" -o "$2"
    printf '%s  %s\n' "$3" "$2" | sha256sum -c -
}

do_deps() {
    echo "=== deps: toolchain ==="
    command -v rustc >/dev/null 2>&1 || brew install -y rust
    command -v git >/dev/null 2>&1 || brew install -y git
    for tool in cargo curl git sha256sum tar patch clang llvm-strip binary-sign-tool readelf node npm; do
        command -v "$tool" >/dev/null 2>&1 || {
            echo "missing build tool: $tool"
            exit 1
        }
    done
}

do_fetch() {
    echo "=== fetch: sources ==="
    rm -rf "$BUILD_DIR"
    mkdir -p "$GITDEPS/wezterm"

    git clone --depth 1 --filter=blob:none --sparse --branch "$VERSION" \
        https://github.com/nrwl/nx.git "$SRC"
    test "$(git -C "$SRC" rev-parse HEAD)" = "$SOURCE_REV"
    git -C "$SRC" sparse-checkout set packages/nx

    download "https://codeload.github.com/JamesHenry/tui-term/tar.gz/$TUI_REV" \
        "$BUILD_DIR/tui-term.tar.gz" 888a71c51f18d90bc85183c2c92469304bc5c697c20ad864fdb73ea8e98d01b0
    download "https://codeload.github.com/JamesHenry/vt100-rust/tar.gz/$VT100_REV" \
        "$BUILD_DIR/vt100-rust.tar.gz" 644bb51e1072711e8e44da70dbfa69e0bcfd1579a289ea3b9758e4ca26113fc1
    curl -fsSL --retry 5 --retry-all-errors --retry-delay 5 \
        "https://codeload.github.com/cammisuli/wezterm/tar.gz/$WEZTERM_REV" \
        -o "$BUILD_DIR/wezterm.tar.gz"
    test "$(gzip -dc "$BUILD_DIR/wezterm.tar.gz" | sha256sum | cut -d ' ' -f 1)" = \
        3a1a58b5a6cdaab64a81677339232f0d843de2ed51f4f78d64b90cefe02f9658
    download "https://crates.io/api/v1/crates/nix/0.27.1/download" \
        "$BUILD_DIR/nix-0.27.1.crate" 2eb04e9c688eff1c89d72b407f168cf79bb9e867a9d3323ed6c01519eb9cc053
    download "https://registry.npmjs.org/$PKG/-/$PKG-$VERSION.tgz" \
        "$BUILD_DIR/$PKG.tgz" 2084e68d1538900e51b34970bb0bb67c73ae2cbc75d13b69d5a20c40f09c5e73

    tar -zxf "$BUILD_DIR/tui-term.tar.gz" -C "$GITDEPS"
    mv "$GITDEPS/tui-term-$TUI_REV" "$GITDEPS/tui-term"
    tar -zxf "$BUILD_DIR/vt100-rust.tar.gz" -C "$GITDEPS"
    mv "$GITDEPS/vt100-rust-$VT100_REV" "$GITDEPS/vt100-rust"
    tar -zxf "$BUILD_DIR/wezterm.tar.gz" -C "$GITDEPS" \
        "wezterm-$WEZTERM_REV/pty" "wezterm-$WEZTERM_REV/filedescriptor"
    mv "$GITDEPS/wezterm-$WEZTERM_REV/pty" "$GITDEPS/wezterm/pty"
    mv "$GITDEPS/wezterm-$WEZTERM_REV/filedescriptor" "$GITDEPS/wezterm/filedescriptor"
    rm -rf "$GITDEPS/wezterm-$WEZTERM_REV"
    tar -zxf "$BUILD_DIR/nix-0.27.1.crate" -C "$GITDEPS"
    tar -zxf "$BUILD_DIR/$PKG.tgz" -C "$BUILD_DIR"
    mv "$BUILD_DIR/package" "$PKG_DIR"
}

do_build() {
    echo "=== build: native binding ==="
    rm -f "$SRC/rust-toolchain" "$SRC/rust-toolchain.toml"
    patch -d "$SRC" -p1 < "$WORK_DIR/patchs/0002-vendor-git-dependencies.patch"
    patch -d "$GITDEPS/nix-0.27.1" -p1 < "$WORK_DIR/patchs/0004-nix-027-ohos.patch"
    patch -d "$GITDEPS/wezterm" -p1 < "$WORK_DIR/patchs/0003-portable-pty-ohos.patch"

    cargo build --release -p nx --manifest-path "$SRC/Cargo.toml"
    test -f "$SRC/target/release/libnx.so"
    cp "$SRC/target/release/libnx.so" "$BUILD_DIR/nx.openharmony-arm64.node"
    llvm-strip --strip-all "$BUILD_DIR/nx.openharmony-arm64.node"
    binary-sign-tool sign -selfSign 1 \
        -inFile "$BUILD_DIR/nx.openharmony-arm64.node" \
        -outFile "$BUILD_DIR/nx.openharmony-arm64.node.signed"
    mv "$BUILD_DIR/nx.openharmony-arm64.node.signed" "$BUILD_DIR/nx.openharmony-arm64.node"
    chmod +x "$BUILD_DIR/nx.openharmony-arm64.node"
}

do_package() {
    echo "=== package: npm port ==="
    patch -d "$PKG_DIR" -p1 < "$WORK_DIR/patchs/0001-openharmony-loader-and-package.patch"
    cp "$BUILD_DIR/nx.openharmony-arm64.node" "$PKG_DIR/src/native/"
}

do_test() {
    echo "=== test: assertions and workspace smoke ==="
    node -e "const p=require('$PKG_DIR/package.json'); if(p.name!=='@ohos-npm-ports/nx'||p.version!=='$PORTS_VERSION') throw Error('package metadata mismatch')"
    grep -q "process.platform === 'openharmony'" "$PKG_DIR/src/native/native-bindings.js"
    grep -q "process.platform == 'openharmony'" "$PKG_DIR/src/native/assert-supported-platform.js"
    readelf -h "$PKG_DIR/src/native/nx.openharmony-arm64.node" | grep -q 'AArch64'
    readelf -S "$PKG_DIR/src/native/nx.openharmony-arm64.node" | grep -q '\.codesign'

    STUB_DIR=$(mktemp -d)
    trap 'rm -rf "$STUB_DIR"' EXIT
    cat > "$STUB_DIR/time_service_stub.c" <<'EOF'
#include <stdint.h>
#include <string.h>

int OH_TimeService_GetTimeZone(char *timezone, uint32_t len) {
  static const char utc[] = "Etc/UTC";
  if (len < sizeof(utc)) return 13000002;
  memcpy(timezone, utc, sizeof(utc));
  return 0;
}
EOF
    clang -shared -fPIC -Wl,-soname,libtime_service_ndk.so \
        -o "$STUB_DIR/libtime_service_ndk.so" "$STUB_DIR/time_service_stub.c"
    export LD_LIBRARY_PATH="$STUB_DIR${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
    node -e "const b=require('$PKG_DIR/src/native/native-bindings.js'); if(b.IS_WASM!==false||typeof b.hashArray!=='function'||typeof b.WorkspaceContext!=='function') throw Error('native binding did not load: IS_WASM='+b.IS_WASM+', exports='+Object.keys(b).length)"

    PKG_TGZ_NAME=$(npm pack --ignore-scripts "$PKG_DIR" --pack-destination "$BUILD_DIR" | tail -1)
    PKG_TGZ="$BUILD_DIR/$PKG_TGZ_NAME"
    tar -tzf "$PKG_TGZ" | grep -q 'src/native/nx.openharmony-arm64.node'

    SMOKE="$BUILD_DIR/smoke"
    mkdir -p "$SMOKE/packages/pkg-a"
    cat > "$SMOKE/package.json" <<EOF
{
  "name": "nx-ohos-smoke",
  "private": true,
  "workspaces": ["packages/*"],
  "dependencies": {"nx": "file:../$PKG_TGZ_NAME"}
}
EOF
    printf '{}\n' > "$SMOKE/nx.json"
    printf '%s\n' '{"name":"pkg-a","version":"1.0.0","scripts":{"build":"echo PKG_A_BUILT"}}' \
        > "$SMOKE/packages/pkg-a/package.json"
    (
        cd "$SMOKE"
        npm install --ignore-scripts
        git init -q .
        export NX_SOCKET_DIR="$SMOKE/.nx-sock"
        mkdir -p "$NX_SOCKET_DIR"
        RUN_OUT=$(./node_modules/.bin/nx run pkg-a:build 2>&1)
        printf '%s\n' "$RUN_OUT"
        printf '%s\n' "$RUN_OUT" | grep -q PKG_A_BUILT
        SHOW_OUT=$(./node_modules/.bin/nx show projects 2>&1)
        printf '%s\n' "$SHOW_OUT"
        printf '%s\n' "$SHOW_OUT" | grep -q pkg-a
        ./node_modules/.bin/nx graph --file="$SMOKE/graph.json"
        test -s "$SMOKE/graph.json"
        ./node_modules/.bin/nx reset
    )
    printf 'nx %s OpenHarmony port: build + smoke test OK\n' "$VERSION"
}

do_deps
do_fetch
do_build
do_package
do_test
