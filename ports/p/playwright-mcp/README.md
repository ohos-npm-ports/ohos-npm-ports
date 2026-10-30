# Playwright MCP

Repackages upstream `@playwright/mcp` as `@ohos-npm-ports/playwright-mcp`.
The `playwright-core` dependency resolves to the matching OpenHarmony core
port. The launcher imports only core; the unused `playwright` dependency is
omitted. Other upstream package files are verified byte-for-byte unchanged.

On OpenHarmony, use an installed TCP CDP browser (default: Haitai), or pass
`--cdp-endpoint` to attach to an existing endpoint. This package does not
provide Chromium, Firefox or WebKit binaries for OpenHarmony. Desktop launch
behavior remains that of upstream core.

`PLAYWRIGHT_CORE_TARBALL=/absolute/path/to/core.tgz npm-ports check ports/p/playwright-mcp` verifies an
unpublished matching core tarball through a consumer-only npm override; the
published MCP manifest always retains the registry alias.
