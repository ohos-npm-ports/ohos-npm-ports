# nw: experimental OpenHarmony local-browser backend

This port preserves the upstream installer and runtime runner on Linux, macOS
and Windows. On OpenHarmony it instead uses the **already installed Haitai
browser**, a local `aa start --ps cmdArgs` invocation and loopback TCP CDP.
It does not build or download another browser on OpenHarmony.

**This is a restricted compatibility bridge, not a native NW.js runtime or a
transparent replacement for arbitrary NW.js applications.** Unsupported features
must be removed from the application or reported as unsupported; they are not
implemented as successful no-ops. `process.versions.nw` is intentionally absent.

## Run

```sh
npm install -D nw@npm:@ohos-npm-ports/nw
npx nw ./my-app -- argument-for-app
```

The app directory must contain a `package.json` with a local HTML `main`.
`aa`, Node and Haitai must already be available. `NWJS_CDP_ENDPOINT` defaults to
`http://127.0.0.1:9222`; only loopback HTTP endpoints with an explicit port are
accepted. An already listening Haitai endpoint is reused. Otherwise the local
ability is started with `cmdArgs` and the configured debug port. An unavailable
endpoint is an error. The adapter never force-stops a browser to make flags work.
Save and close an existing browser manually if it ignores new startup arguments.

A separate browser context/page is created for the application. Closing the
session closes that context and disconnects its CDP client, not the user's other
browser windows. `run({ srcDir, argv, endpoint })` returns a session containing
`page`, `context`, `close()` and `closed` on OpenHarmony, not a native child process.

## Supported subset

- Local HTML/CSS/JS resources within the application directory.
- Synchronous `require('fs')`, `require('path')`, `require('os')` and their `node:`
  aliases; local JSON module imports. `nw.require` aliases the same function.
- `fs.readFileSync` with explicit UTF-8 encoding (at most 1 MiB), text-only
  `writeFileSync`, `existsSync`, `readdirSync` without options, `mkdirSync` with
  optional `recursive`, and `unlinkSync`. File paths stay inside the app root.
- Pure `path` basename/dirname/extname/isAbsolute/join/normalize/relative/resolve/
  parse/format operations; `sep` and `delimiter`.
- `os.platform/arch/type/release/endianness` and `EOL`.
- `process.platform/arch/versions.node/argv/cwd()`, `__dirname`, `nw.process`.
- `nw.App.argv/quit()` and current `nw.Window.get()` title/reload/close plus the
  `loaded` event. Manifest `window.title` is accepted.
- `nodejs: false` disables the page bridge and its capability endpoint.

All synchronous host calls use synchronous same-origin HTTP requests. They
block the renderer; this bridge is intended for small operations, not large
files, streams, CPU-heavy work or requests that need the blocked page to execute
more JavaScript. RPC request bodies are limited to 64 KiB.

## Not supported

Arbitrary JavaScript/CommonJS/ESM modules in `require`, third-party Node modules,
Buffer/binary fs results, async fs, native addons, workers, child processes,
DOM/Node object sharing, NW mixed contexts, menus, tray, native window styling,
other window events, SDK/nwjc/NWBin and `.nw` archives are not supported.
Manifest `node-main`, `node-remote`, injection scripts, `chromium-args`, remote
`main` and window options other than `title` are rejected.

`findpath()` explicitly fails on OpenHarmony because no standalone NW executable
is installed. `get()` only checks the local backend's availability. Selecting a
runtime version, SDK flavor or another target platform is not supported there.
Other operating systems retain the upstream API implementations.

## Trust and isolation

Only run trusted local applications. This is not an OS sandbox. The server binds
127.0.0.1, uses unpredictable resource paths, validates Host/Origin and a
per-session capability token, exposes no wildcard CORS, checks resolved file
paths and rejects symlink escapes. Capabilities are injected only into the
application's top-level origin/path, never arbitrary remote navigations/frames.
Local filesystem mutation races or a compromised local application are outside
the security boundary. Public CDP access itself grants browser control; do not
expose its port to the network.

## Verification

The NPMBUILD lifecycle validates the pinned npm source, preserves unaffected upstream file
hashes, tests three desktop dispatch paths, validates the capability server and
browser bootstrap, packs the artifact, installs it into a clean consumer and
repeats the implementation tests from the installed package. The standard
`test.js` checks actual installs on the five consumer matrix targets without
starting or downloading a browser. Browser downloads during consumer baseline
installation are disabled in the temporary fixture only.

The fixture in `tests/fixtures/app` is also used for HarmonyOS device validation:
DOM, synchronous UTF-8 reads/writes, JSON import, platform/argv and `loaded` must
work against the installed Haitai browser, with file output checked by Node.
