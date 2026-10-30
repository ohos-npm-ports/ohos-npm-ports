# playwright-core: local aa + TCP CDP

This revision launches installed OpenHarmony browsers with the local `aa`
command and connects directly to their TCP CDP endpoint. It does not install
Chromium, use a device connector, forward ports or force-stop applications.

```js
const { chromium } = require('@ohos-npm-ports/playwright-core');
const browser = await chromium.launch({ channel: 'chrome' }); // installed Haitai
const context = await browser.newContext();
const page = await context.newPage();
await page.goto('http://127.0.0.1:3000');
```

`chrome` selects `com.haitai.htbrowser` / `EntryAbility`. `aa` must be on PATH.
`harmonyDebugPort`, `harmonyArgs` and `harmonyLaunchUrl` remain available.
A missing command, a failed launch or an unavailable local CDP endpoint is an
error, with no alternate backend. If an existing browser ignores new command
arguments, save its work and close it manually before retrying.

`huaweiBrowser` uses a Unix-domain debug socket and is no longer supported by
`launch()`. Use an installed TCP CDP browser, or attach to an already available
endpoint using `chromium.connectOverCDP()`.

The `lib/ohos` entry exports `launchViaAa`, not `launchViaHdc`. `HdcBackend`,
`hdcScreenshot`, `resolveOhosAa` and device screenshot fallback are removed.
`takeScreenshot()` uses the page's CDP screenshot and propagates failures.
`chromium.executablePath()` on OpenHarmony identifies `aa`, not a browser ELF.

`browser.close()` / `browserServer.kill()` close the launched browser through CDP.
Do not call these on a browser whose other windows you intend to preserve.
Desktop platform launch behavior remains upstream behavior.
