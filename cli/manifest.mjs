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

const dependencyFields = new Set(['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']);
const unsafeNames = new Set(['__proto__', 'prototype', 'constructor']);

function manifestObject(pkg, field, allowedFields, create = false) {
  if (!allowedFields.has(field)) throw new Error(`Unsupported manifest field: ${field}`);
  if (pkg[field] === undefined) {
    if (create) pkg[field] = {};
    else return {};
  } else if (!pkg[field] || typeof pkg[field] !== 'object' || Array.isArray(pkg[field])) {
    throw new Error(`${field} must be an object`);
  }
  return pkg[field];
}

function validateName(name) {
  if (!name || unsafeNames.has(name)) throw new Error(`Unsafe manifest key: ${name}`);
}

function validateValue(value) {
  if (typeof value !== 'string' || !value) throw new Error('Manifest values must be non-empty strings');
}

export function setDependency(pkg, field, name, value) {
  const values = manifestObject(pkg, field, dependencyFields, true);
  validateName(name);
  validateValue(value);
  if (values[name] === value) return false;
  values[name] = value;
  return true;
}

export function removeDependencies(pkg, field, names) {
  const values = manifestObject(pkg, field, dependencyFields);
  let changed = false;
  for (const name of names) {
    validateName(name);
    if (Object.hasOwn(values, name)) {
      delete values[name];
      changed = true;
    }
  }
  return changed;
}

export function pinDependencies(pkg, field, version) {
  const values = manifestObject(pkg, field, dependencyFields);
  validateValue(version);
  let changed = false;
  for (const name of Object.keys(values)) {
    validateName(name);
    if (values[name] !== version) {
      values[name] = version;
      changed = true;
    }
  }
  return changed;
}

export function setImport(pkg, name, value) {
  if (!name.startsWith('#') || name.length < 2) throw new Error(`Invalid import specifier: ${name}`);
  validateName(name);
  validateValue(value);
  const values = manifestObject(pkg, 'imports', new Set(['imports']), true);
  if (values[name] === value) return false;
  values[name] = value;
  return true;
}

function main() {
  const [operation, file, ...values] = process.argv.slice(2);
  const pkg = file ? readManifest(file) : null;
  let changed;
  if (operation === 'add-files') changed = addFiles(pkg, values);
  else if (operation === 'remove-scripts') changed = removeScripts(pkg, values);
  else if (operation === 'set-dependency' && values.length === 3) changed = setDependency(pkg, ...values);
  else if (operation === 'remove-dependencies' && values.length >= 2) changed = removeDependencies(pkg, values[0], values.slice(1));
  else if (operation === 'pin-dependencies' && values.length === 2) changed = pinDependencies(pkg, ...values);
  else if (operation === 'set-import' && values.length === 2) changed = setImport(pkg, ...values);
  else throw new Error(`Invalid manifest operation or arguments: ${operation}`);
  if (changed) writeManifest(file, pkg);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
