import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { registryConfig } from './consumer-registry.mjs';

test('artifact packages are local-only and ordinary dependencies retain the upstream proxy', () => {
  const config = registryConfig('/tmp/test registry', '127.0.0.1:4873', [
    { name: '@ohos-npm-ports/demo' },
    { name: '@ohos-npm-ports/demo-openharmony-arm64' },
    { name: '@ohos-npm-ports/demo' },
  ]);
  for (const name of ['@ohos-npm-ports/demo', '@ohos-npm-ports/demo-openharmony-arm64']) {
    const rule = `  ${JSON.stringify(name)}:\n    access: $all\n    publish: $authenticated\n`;
    assert.equal(config.split(rule).length - 1, 1);
    assert.ok(config.indexOf(rule) < config.indexOf("  '**':"));
  }
  assert.equal(config.match(/proxy: npmjs/g)?.length, 1);
  assert.ok(config.includes(`storage: ${JSON.stringify(join('/tmp/test registry', 'storage'))}`));
  assert.match(config, /'\*\*':\n    access: \$all\n    publish: \$authenticated\n    proxy: npmjs/);
});

test('both consumer runners use the shared registry configuration', () => {
  for (const file of ['run-install-matrix.mjs', 'run-port-consumer.mjs']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /import \{ registryConfig \} from '\.\/consumer-registry.mjs'/);
    assert.match(source, /writeFileSync\(config, registryConfig\(/);
    assert.doesNotMatch(source, /proxy: npmjs/);
  }
});
