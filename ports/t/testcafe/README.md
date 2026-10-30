# TestCafe on OpenHarmony

This port preserves upstream behavior on other platforms. On OpenHarmony, the `chrome`, `chromium`, `haitai`, and `ohos` aliases use Haitai through local `aa` and TCP CDP. No hdc or Playwright dependency is required.

```json
{"devDependencies":{"testcafe":"npm:@ohos-npm-ports/testcafe@3.7.6-1"}}
```

```sh
npx testcafe chrome tests
```

Haitai must be installed. If an existing browser was started without remote debugging or without popup support, close it manually before the first test run. The launcher does not terminate user sessions. `HARMONY_DEBUG_PORT` selects an explicit loopback CDP port; otherwise a validated endpoint cache is reused or aa starts a browser on an available port.

Each connection owns an isolated browser context. Input, assertions, uploads, frames, dialogs, cookies, localStorage, navigation, and window switching use TestCafe's proxy automation. CDP provides tab lifecycle, foreground activation, PNG capture, and real window bounds control. Window size/state is restored before context disposal when the relevant window still exists. Context disposal also removes child windows left open by a test.

Viewport/full-page/element screenshots and PNG thumbnails are supported. Set `TESTCAFE_DOWNLOAD_DIR` to a dedicated absolute directory to save attachment downloads without a prompt. The provider streams the actual browser response through CDP into the CLI filesystem, because browser-side native download saving can be canceled on HarmonyOS. It does not refetch the URL or change the settings of user browser contexts.

Native Automation, headless mode, video recording, and browsers other than Haitai are not implemented by this backend. It keeps the active test tab in the foreground; parallel foreground-driven sessions are not validated. Pure JavaScript code is added; upstream authorship and license remain intact.

The NPMBUILD lifecycle verifies the pinned upstream archive, checks the permitted file-change set, packs and installs the result, runs unit/platform-routing tests, and checks the CLI. `test.js` provides the repository's baseline/override consumer contract. Physical-device browser verification is additional evidence, not a capability of the build container.

## Device regression

Copy `tests/device/` into an otherwise empty project, create `logs/`, and install the packed artifact under the upstream name (`npm install testcafe@file:/absolute/path/to/ohos-npm-ports-testcafe-3.7.6-1.tgz`). From that project:

```sh
TESTCAFE_CHECK_THUMBNAILS=1 TESTCAFE_DOWNLOAD_DIR="$PWD/logs/downloads" node run.mjs --auto-native --suite=provider-screenshot
TESTCAFE_DOWNLOAD_DIR="$PWD/logs/downloads" node run.mjs --auto-native --suite=download
```

Other suites are `smoke`, `extended`, `windows`, `window-screenshot`, `provider-window`, `typescript`, and `leaked-window`. `negative --failure-screenshots` deliberately fails one assertion and succeeds only when exactly one test fails and an actual screenshot is produced. `--auto-native` omits an explicit disableNativeAutomation setting, checking that the backend selects proxy mode automatically. The scripts keep and activate their test window, so run them serially.

Adapter diagnostics are silent by default; set `TESTCAFE_OHOS_DEBUG=1` to send them to stderr without contaminating JSON reporter stdout.
