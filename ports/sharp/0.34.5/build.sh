#!/bin/sh
set -e

# Ports sharp (image processing) to OpenHarmony, built natively from source:
# a from-scratch libvips 8.18.6 build (this container's rustc/clang host
# triple is already aarch64-unknown-linux-ohos, no cross-compile toolchain
# needed) linked against sharp's own N-API addon.
#
# Why this exists: the community @ohos-ports/sharp build (0.34.5-beta.5) hit
# a crash at require() time -- lib/utility.js unconditionally reads
# format.jp2k.output.alias, and that build's native binding never populated
# the jp2k (JPEG2000) key at all, because the libvips it links against was
# compiled without openjpeg support. This build enables openjpeg explicitly
# and verifies a real jp2k encode/decode round-trip below, not just that the
# key exists.
#
# Dependency strategy: unlike most native-binding ports in this repo, sharp
# pulls in libvips's own dependency tree (~25 codec/rendering libraries --
# glib, cairo, pango, libjpeg-turbo, libwebp, openjpeg, libheif, etc). Rather
# than vendoring all of them into the npm package (large, and duplicates
# what a Harmonybrew-based OHOS project already has installed), this build
# only bundles the two libraries it builds itself (libvips.so / libvips-cpp.so)
# and leaves the rest resolved via RPATH pointing at the Harmonybrew prefix
# (~/.harmonybrew/lib) -- consumers need `brew install` for the codec
# libraries listed below. This matches the intended consumer (ohos-bun's own
# test suite, which already requires Harmonybrew) rather than optimizing for
# standalone npm/bun users with no Harmonybrew install.

SHARP_VERSION=0.34.5
VIPS_VERSION=8.18.6

# node: to drive npm install / run verification scripts.
# patchelf: to bake a working RPATH into the final .so/.node (consumer
#   devices won't have this build's absolute paths, only the Harmonybrew
#   prefix and $ORIGIN-relative siblings).
# The rest is libvips's own build + runtime dependency chain.
brew install -y node patchelf \
  jpeg-turbo libpng webp libtiff giflib glib little-cms2 highway cgif \
  meson pkgconf exiv2 libarchive libheif libde265 libspng librsvg cairo \
  pango freetype fontconfig libimagequant openjpeg aom dav1d orc gettext

BREW_PREFIX="$(brew --prefix)"
export PATH="${BREW_PREFIX}/bin:${PATH}"
export LIBRARY_PATH="${BREW_PREFIX}/lib"

# --- libvips: build from source with jp2k (openjpeg) support ---
curl -fsSL "https://github.com/libvips/libvips/releases/download/v${VIPS_VERSION}/vips-${VIPS_VERSION}.tar.xz" -o vips.tar.xz
tar -xf vips.tar.xz
rm vips.tar.xz
cd "vips-${VIPS_VERSION}"
patch -p1 < ../patchs/0001-libvips-disable-nls-and-tools-build.patch

# Every meson feature option here defaults to 'auto' (enable if the
# corresponding brew package is present, silently skip otherwise), so this
# only needs to name what's actually different from that default: force
# openjpeg on (the fix), and keep heif out of a dynamic module (see the
# RPATH comment on vendor/ below). jpeg-xl/fftw/openslide/etc. are already
# 'auto'-disabled since those brew packages aren't installed -- no need to
# disable them explicitly.
meson setup build --prefix="$(pwd)/../vips-install" \
  -Dopenjpeg=enabled \
  -Dheif-module=disabled \
  -Dexamples=false

ninja -C build
ninja -C build install

# jp2k (JPEG2000) must actually be enabled, not silently skipped.
grep -q "JPEG2000 load/save with libopenjp2.*YES" build/meson-logs/meson-log.txt \
  || { echo "openjpeg/jp2k support did not get enabled" >&2; exit 1; }

cd ..
VIPS_INSTALL="$(pwd)/vips-install"

# --- sharp: build from source against our libvips ---
curl -fsSL "https://registry.npmjs.org/sharp/-/sharp-${SHARP_VERSION}.tgz" -o sharp.tgz
mkdir sharp-src
tar -xzf sharp.tgz -C sharp-src --strip-components=1
rm sharp.tgz
cd sharp-src

export PKG_CONFIG_PATH="${VIPS_INSTALL}/lib/pkgconfig"
export SHARP_FORCE_GLOBAL_LIBVIPS=1
npm install

test -f src/build/Release/sharp-openharmony-arm64.node

cd ..

# --- assemble the npm package ---
rm -rf pkg
mkdir -p pkg/vendor pkg/src/build/Release
cp -r sharp-src/lib pkg/lib
cp sharp-src/package.json pkg/package.json
(cd pkg && patch -p1 < ../patchs/0002-package-json.patch)
cp sharp-src/src/build/Release/sharp-openharmony-arm64.node pkg/src/build/Release/sharp-openharmony-arm64.node

# Ship the two libs we build under their bare SONAME (not the fully
# versioned filename + a symlink) -- symlinks are not reliably preserved
# across npm pack/publish and various file: install paths, and the dynamic
# linker only ever looks up the SONAME string baked into the .node's NEEDED
# entry anyway.
cp "${VIPS_INSTALL}/lib/libvips.so.42.20.6" pkg/vendor/libvips.so.42
cp "${VIPS_INSTALL}/lib/libvips-cpp.so.42.20.6" pkg/vendor/libvips-cpp.so.42

# The OHOS-patched LLD toolchain already stamps a (placeholder, empty)
# .codesign section into every binary it links -- patchelf refuses to touch
# an ELF that already has one ("already has a .codesign section; strip first
# or use --force"), since editing sections after signing would normally
# invalidate a real signature. Strip it before patchelf; binary-sign-tool
# adds a real one afterwards.
llvm-strip --strip-all pkg/src/build/Release/sharp-openharmony-arm64.node
llvm-strip --strip-all pkg/vendor/libvips-cpp.so.42
llvm-strip --strip-all pkg/vendor/libvips.so.42

patchelf --set-rpath "\$ORIGIN/../../../vendor:${BREW_PREFIX}/lib" pkg/src/build/Release/sharp-openharmony-arm64.node
patchelf --set-rpath "\$ORIGIN:${BREW_PREFIX}/lib" pkg/vendor/libvips-cpp.so.42
patchelf --set-rpath "\$ORIGIN:${BREW_PREFIX}/lib" pkg/vendor/libvips.so.42

for f in pkg/src/build/Release/sharp-openharmony-arm64.node pkg/vendor/libvips.so.42 pkg/vendor/libvips-cpp.so.42; do
  binary-sign-tool sign -selfSign 1 -inFile "$f" -outFile "$f.signed"
  mv "$f.signed" "$f"
done

# --- verify ---
NAME=$(node -e "console.log(require('./pkg/package.json').name)")
[ "$NAME" = "@ohos-npm-ports/sharp" ]

# cross-platform: upstream's platform optionalDependencies must stay intact
node -e '
  const pkg = require("./pkg/package.json");
  const n = Object.keys(pkg.optionalDependencies ?? {}).length;
  if (n !== 24) throw new Error(`optionalDependencies count: ${n}, expected 24`);
  if (pkg.optionalDependencies["@img/sharp-linux-arm64"] !== "0.34.5")
    throw new Error("sharp platform subpackage version drifted");
  if (pkg.optionalDependencies["@img/sharp-libvips-linuxmusl-arm64"] !== "1.2.4")
    throw new Error("libvips platform subpackage version drifted");
  console.log("optionalDependencies preserved:", n, "platform packages");
'

readelf -h pkg/src/build/Release/sharp-openharmony-arm64.node | grep -q 'AArch64'
readelf -S pkg/src/build/Release/sharp-openharmony-arm64.node | grep -q '\.codesign'

# Real functional smoke test against the FINAL pkg/ layout (RPATH resolved
# via $ORIGIN + the Harmonybrew prefix, no manual LD_LIBRARY_PATH) -- this is
# exactly what a consumer gets, not just the build tree. pkg/ itself ships no
# node_modules (npm always excludes it from the published tarball regardless
# of "files"), so point NODE_PATH at the node_modules our own `npm install`
# above already populated with sharp's real dependencies (detect-libc,
# semver, @img/colour) -- a real consumer's `npm install` does this
# resolution itself; this is purely a stand-in for that step.
export NODE_PATH="$(pwd)/sharp-src/node_modules"
export OPENSSL_CONF=/dev/null
node -e '
  const path = require("path");
  const sharp = require(path.join(process.cwd(), "pkg", "lib", "index.js"));
  (async () => {
    const png = await sharp({
      create: { width: 40, height: 30, channels: 3, background: { r: 5, g: 200, b: 40 } },
    }).png().toBuffer();

    const jp2 = await sharp(png).jp2().toBuffer();
    const back = await sharp(jp2).raw().toBuffer({ resolveWithObject: true });
    if (back.info.width !== 40 || back.info.height !== 30) {
      throw new Error("jp2k round-trip size mismatch: " + JSON.stringify(back.info));
    }
    if (!sharp.format.jp2k || !sharp.format.jp2k.output) {
      throw new Error("format.jp2k missing or incomplete: " + JSON.stringify(sharp.format.jp2k));
    }

    // avif/heif also depend on libheif, now statically linked into libvips
    // (heif-module=disabled above) instead of a dynamic module whose path
    // would only resolve inside this build tree.
    const avif = await sharp(png).avif().toBuffer();
    if (avif.length === 0) throw new Error("avif encode produced no bytes");

    console.log(
      "OK: jp2k round-trip", jp2.length, "bytes,", back.info.width + "x" + back.info.height,
      "| avif encode", avif.length, "bytes",
    );
  })().catch((e) => { console.error("FAIL:", e); process.exit(1); });
'

echo "OK: @ohos-npm-ports/sharp built and smoke-tested"
