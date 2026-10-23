import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { normalizePackage } from "../scripts/sync.mjs";
const manifest = {
  name: "@ohos-npm-ports/example",
  description: "<img src=x onerror=alert(1)>",
  "dist-tags": { latest: "2.0.0-1", "legacy-1": "1.0.0-2" },
  time: { "2.0.0-1": "2026-01-01T00:00:00Z" },
  versions: {
    "2.0.0-1": { license: "MIT" },
    "1.0.0-2": { deprecated: "Use upstream" },
  },
};
test("latest is selected by tag, not by prerelease suffix or publish order", () => {
  const p = normalizePackage(manifest, {
    upstream: "@original/example",
    directories: ["ports/example/2.0.0"],
  });
  assert.equal(p.version, "2.0.0-1");
  assert.equal(p.status, "active");
  assert.equal(p.description, manifest.description);
  assert.equal(p.versions.length, 2);
  assert.equal(p.versions.find((v) => v.version === "1.0.0-2").deprecated, "Use upstream");
});
test("missing latest is not guessed and deprecation is version-specific", () => {
  assert.equal(normalizePackage({ ...manifest, "dist-tags": {} }).version, null);
  const p = normalizePackage({
    ...manifest,
    "dist-tags": { latest: "1.0.0-2" },
  });
  assert.equal(p.status, "deprecated");
});
