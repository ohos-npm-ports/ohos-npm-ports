#!/bin/sh
set -e

# node-gyp (nan) build: this container's node-gyp already recognizes
# openharmony/arm64 and generates a working Makefile — no cross-compile
# target/toolchain wrapper needed, same as the napi-rs ports.

VERSION=5.17.0
PKG=datadog-pprof

curl -fsSL "https://github.com/DataDog/pprof-nodejs/archive/refs/tags/v${VERSION}.tar.gz" -o pprof.tar.gz
tar -zxf pprof.tar.gz
rm pprof.tar.gz
mv "pprof-nodejs-${VERSION}" "${PKG}-${VERSION}"

cd "${PKG}-${VERSION}"
patch -p1 < ../patchs/0001-update-package-json.patch

# node-gyp isn't a devDependency of this package (upstream relies on it being
# available globally / bundled with npm), so install it explicitly to get it
# onto node_modules/.bin. --ignore-scripts also skips the "prepare" script
# (compile + rebuild) so we can run each step ourselves and check its output.
npm install --ignore-scripts
npm install --ignore-scripts --no-save node-gyp
export PATH="$(pwd)/node_modules/.bin:$PATH"

npm run compile

# The image's default clang predates C++20: node's v8 headers pull in
# <source_location> unconditionally, so the addon build needs a modern clang.
# Use llvm@22 — the same toolchain the core node formula itself is built
# with, so the addon's libc++ ABI (__n1 namespace) matches node's exported
# v8:: symbols by construction. llvm@2x declares a conflict with the image's
# linked ohos-sdk (both provide `clang` binaries), so unlink it first;
# keg_only llvm is not on PATH, hence the explicit CC/CXX.
brew unlink ohos-sdk || true
brew install -y llvm@22 lld@22
LLVM_BIN="$(brew --prefix)/opt/llvm@22/bin"
export CC="$LLVM_BIN/clang" CXX="$LLVM_BIN/clang++"
export PATH="$LLVM_BIN:$(brew --prefix)/opt/lld@22/bin:$PATH"
node-gyp rebuild --jobs=max

ABI=$(node -p process.versions.modules)
# node-gyp-build's resolver keys the prebuild filename off of this value; fail
# loudly instead of silently shipping a mis-named binary.
[ "$ABI" = "147" ] || { echo "unexpected ABI $ABI (expected 147)" >&2; exit 1; }

mkdir -p prebuilds/openharmony-arm64
cp "build/Release/dd_pprof.node" "prebuilds/openharmony-arm64/dd_pprof.node.abi${ABI}.node"

cd prebuilds/openharmony-arm64
llvm-strip --strip-all "dd_pprof.node.abi${ABI}.node"
# brew unlink ohos-sdk (above) removed its PATH symlinks, incl. this tool;
# call it via the keg path.
"$(brew --prefix)/opt/ohos-sdk/bin/binary-sign-tool" sign -selfSign 1 -inFile "dd_pprof.node.abi${ABI}.node" -outFile "dd_pprof.node.abi${ABI}.node.signed"
mv "dd_pprof.node.abi${ABI}.node.signed" "dd_pprof.node.abi${ABI}.node"
chmod +x "dd_pprof.node.abi${ABI}.node"
cd ../..

# Merge in the other 5 platforms' already-published prebuilt binaries so this
# package keeps working everywhere else, not just on OHOS (node-gyp-build
# resolves from a single prebuilds/ tree bundled in the one npm package,
# same model as bufferutil).
curl -fsSL "https://registry.npmjs.org/@datadog/pprof/-/pprof-${VERSION}.tgz" -o official.tgz
tar -zxf official.tgz
cp -r package/prebuilds/darwin-arm64 package/prebuilds/darwin-x64 \
      package/prebuilds/linux-arm64 package/prebuilds/linux-x64 \
      package/prebuilds/win32-x64 prebuilds/
rm -rf package official.tgz

# node-gyp-build checks build/Release before prebuilds/ (its own local-build
# fast path), and it would happily resolve to the addon still sitting there
# from the node-gyp invocation above. That path isn't in this package's
# "files" list, so real consumers installing from npm never see it — but
# leaving it here would make the resolver check below pass for the wrong
# reason. Remove it so the check reflects what actually gets published.
rm -rf build

# --- verify package contents ---

NAME=$(node -e "console.log(require('./package.json').name)")
[ "$NAME" = "@ohos-npm-ports/datadog-pprof" ]

[ -z "$(node -e "console.log(require('./package.json').postinstall || '')")" ]

readelf -h "prebuilds/openharmony-arm64/dd_pprof.node.abi${ABI}.node" | grep -q 'AArch64'
readelf -S "prebuilds/openharmony-arm64/dd_pprof.node.abi${ABI}.node" | grep -q '\.codesign'

# node-gyp-build's own resolver must pick our file (path resolution only,
# doesn't dlopen — safe to run under plain node).
RESOLVED=$(node -e "console.log(require('./node_modules/node-gyp-build').resolve('.'))")
case "$RESOLVED" in
  */prebuilds/openharmony-arm64/dd_pprof.node.abi"${ABI}".node) ;;
  *) echo "node-gyp-build resolved to unexpected path: $RESOLVED" >&2; exit 1 ;;
esac

# Real functional smoke test: dlopen the addon and drive its actual V8
# CPU-profiler API with harmonybrew's core node (llvm-built, ABI compatible
# with this addon).
brew install -y node

NODE_BIN="$(brew --prefix)/opt/node/bin/node"
"$NODE_BIN" --version

"$NODE_BIN" -e '
  const { time } = require("./out/src/index.js");

  function hotLoop() {
    const start = Date.now();
    let acc = 0;
    while (Date.now() - start < 300) {
      for (let i = 0; i < 1000; i++) acc += Math.sqrt(i);
    }
    return acc;
  }

  time.start({ intervalMicros: 1000, durationMillis: 60000 });
  hotLoop();
  const profile = time.stop();

  const strings = profile.stringTable.strings;
  const summary = {
    sampleCount: profile.sample.length,
    locationCount: profile.location.length,
    functionCount: profile.function.length,
    hasHotLoop: strings.includes("hotLoop"),
  };
  console.log("TimeProfiler summary:", JSON.stringify(summary));
  if (summary.sampleCount === 0 || !summary.hasHotLoop) {
    throw new Error("smoke test failed: no samples or missing hotLoop frame");
  }
'
