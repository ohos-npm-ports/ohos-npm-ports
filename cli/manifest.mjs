import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function readManifest(file) {
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) throw new Error(`${file}: manifest must be a JSON object`);
  return pkg;
}

function writeManifest(file, pkg) {
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
}

export function addFiles(pkg, paths) {
  if (pkg.files === undefined) return false;
  if (!Array.isArray(pkg.files)) throw new Error('files must be an array');
  let changed = false;
  for (const path of paths) {
    if (!path || path.startsWith('/') || path.startsWith('!') || path.split('/').includes('..')) {
      throw new Error(`Unsafe package file path: ${path}`);
    }
    if (!pkg.files.includes(path)) {
      pkg.files.push(path);
      changed = true;
    }
  }
  return changed;
}

export function removeScripts(pkg, names) {
  if (pkg.scripts !== undefined && (!pkg.scripts || typeof pkg.scripts !== 'object' || Array.isArray(pkg.scripts))) {
    throw new Error('scripts must be an object');
  }
  const lifecycle = new Set(['preinstall', 'install', 'postinstall', 'prepublish', 'prepublishOnly', 'prepare']);
  let changed = false;
  for (const name of names) {
    if (!name || ['__proto__', 'prototype', 'constructor'].includes(name)) throw new Error(`Unsafe script name: ${name}`);
    if (pkg.scripts && Object.hasOwn(pkg.scripts, name)) {
      delete pkg.scripts[name];
      changed = true;
    }
    if (lifecycle.has(name) && Object.hasOwn(pkg, name)) {
      delete pkg[name];
      changed = true;
    }
  }
  return changed;
}

function main() {
  const [operation, file, ...values] = process.argv.slice(2);
  if (!file || values.length === 0 || !['add-files', 'remove-scripts'].includes(operation)) {
    throw new Error('Usage: manifest.mjs <add-files|remove-scripts> <package.json> <value...>');
  }
  const pkg = readManifest(file);
  const changed = operation === 'add-files' ? addFiles(pkg, values) : removeScripts(pkg, values);
  if (changed) writeManifest(file, pkg);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
