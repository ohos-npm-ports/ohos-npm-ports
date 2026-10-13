import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function installedPackage(require, specifier) {
  try {
    const path = require.resolve(`${specifier}/package.json`);
    return { path, manifest: JSON.parse(readFileSync(path, 'utf8')) };
  } catch (error) {
    if (!['ERR_PACKAGE_PATH_NOT_EXPORTED', 'MODULE_NOT_FOUND'].includes(error.code)) throw error;
  }
  for (const base of require.resolve.paths(specifier) ?? []) {
    const path = join(base, specifier, 'package.json');
    if (existsSync(path)) return { path, manifest: JSON.parse(readFileSync(path, 'utf8')) };
  }
  let directory = dirname(require.resolve(specifier));
  for (;;) {
    const path = join(directory, 'package.json');
    if (existsSync(path)) {
      const manifest = JSON.parse(readFileSync(path, 'utf8'));
      if (manifest.name) return { path, manifest };
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Cannot locate installed package manifest: ${specifier}`);
    directory = parent;
  }
}
