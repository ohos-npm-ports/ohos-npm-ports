import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { resourceDeclarations } from './bump.mjs';

function lintPatch(file, text, port) {
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const ownReference = new RegExp(`@ohos-npm-ports/${escape(port.pkgname)}[A-Za-z0-9._-]*@${escape(port.version)}-\\d+(?!\\d)`);
  if (ownReference.test(text)) {
    throw new Error(`${file}: current port revisions must be injected by npm-ports pack, not patches`);
  }
  let existingPackageJson = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('--- ')) existingPackageJson = line.trim() !== '--- /dev/null';
    if (line.startsWith('+++ ')) {
      const target = line.slice(4).split('\t')[0];
      existingPackageJson &&= /^(?:b\/)?(?:.*\/)?package\.json$/.test(target);
    }
    if (existingPackageJson && /^[+-]\s*"version"\s*:/.test(line)) {
      throw new Error(`${file}: patches must not change package.json version; retain upstream ${port.version}`);
    }
  }
}

function lintImplementation(directory, source, file, port) {
  const patches = join(directory, 'patches');
  if (!existsSync(patches)) return;
  const appliesAll = /patches\/\*\.patch|patches\/\*[^.]/.test(source);
  for (const entry of readdirSync(patches)) {
    if (!entry.endsWith('.patch')) continue;
    const patch = join(patches, entry);
    if (!appliesAll && !source.includes(entry)) throw new Error(`${file}: patches/${entry} is never applied`);
    lintPatch(patch, readFileSync(patch, 'utf8'), port);
  }
}

function lintDeclarations(source, file) {
  const declarations = new Map();
  for (const line of source.split('\n')) {
    if (/^[A-Za-z_][A-Za-z0-9_]*\(\) \{/.test(line)) break;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=/.exec(line);
    if (!match) continue;
    if (declarations.has(match[1])) throw new Error(`${file}: duplicate global assignment ${match[1]}`);
    declarations.set(match[1], true);
  }
  const alias = /^\s*(?:export\s+)?(version|pkgname)=["']?\$\{?\1\}?["']?\s*$/m.exec(source);
  if (alias) throw new Error(`${file}: metadata alias ${alias[1]} is redundant; reference it directly`);
  if (/^\s*(?:export\s+)?(?:VERSION|UPSTREAM_VERSION|PKG_VERSION)=["']?\d/m.test(source)) {
    throw new Error(`${file}: version literals must reference the version metadata`);
  }
  const legacyAlias = /^\s*(?:export\s+)?(VERSION|UPSTREAM_VERSION|PKG_VERSION|PKG_NAME|PKG|PORTS_VERSION|PORT_VERSION|SLOT_VERSION)=/m.exec(source);
  if (legacyAlias) throw new Error(`${file}: legacy metadata alias ${legacyAlias[1]}; use lower_snake_case or the global metadata directly`);
  const hashes = source.match(/\b[0-9a-f]{64}\b/g) ?? [];
  if (new Set(hashes).size !== hashes.length) throw new Error(`${file}: duplicate SHA-256 literal; declare it once and reference it`);
}

export function lintPort(port) {
  const file = join(port.dir, 'NPMBUILD');
  execFileSync('bash', ['-n', file], { stdio: ['ignore', 'pipe', 'inherit'] });
  const source = readFileSync(file, 'utf8');
  lintDeclarations(source, file);
  const declarations = resourceDeclarations(source);
  const firstHook = source.search(/^[A-Za-z_][A-Za-z0-9_]*\(\) \{/m);
  if (firstHook !== -1 && /^resource\s/m.test(source.slice(firstHook))) {
    throw new Error(`${file}: resource declarations must precede lifecycle hooks`);
  }
  for (const declaration of declarations) {
    if (declaration.url.includes(port.version) && !declaration.url.includes('${version}') && !/\$version(?![A-Za-z0-9_])/.test(declaration.url)) {
      throw new Error(`${file}: resource ${declaration.name} must reference \${version} instead of repeating ${port.version}`);
    }
  }
  for (const line of source.split('\n')) {
    if (/^\s*(?:\$\{?curl\}?|curl)\s/.test(line) && !/(?:-fsIL|\s-I(?:\s|$)|--head)/.test(line)) {
      throw new Error(`${file}: use fetch_source or fetch_resource for downloads`);
    }
  }
  if (/\bNPMBUILD_(?:REVISION|PORT_VERSION)\b/.test(source) || /\$\{?version\}?-\d+/.test(source)) {
    throw new Error(`${file}: use bare upstream version; revision is injected only by npm-ports pack`);
  }
  if (/\breadelf\b/.test(source)) {
    throw new Error(`${file}: readelf checks are not needed in NPMBUILD`);
  }
  if (/binary-sign-tool|sign -selfSign|\.codesign|ohos-selfsign/.test(source)) {
    throw new Error(`${file}: ELF signing and signature checks are managed by npm-ports pack`);
  }
  if (/\n[ \t]*\n[ \t]*\n/.test(source)) {
    throw new Error(`${file}: collapse consecutive blank lines`);
  }
  if (source.split('\n').some((line) => !line.trimStart().startsWith('#') && line.includes('npm publish'))) {
    throw new Error(`${file}: publishing is managed by npm-ports, not NPMBUILD`);
  }
  const directories = [port.dir];
  const slots = join(port.dir, 'slots');
  if (existsSync(slots)) {
    for (const entry of readdirSync(slots, { withFileTypes: true })) {
      if (entry.isDirectory()) directories.push(join(slots, entry.name));
    }
  }
  for (const directory of directories) {
    if (existsSync(join(directory, 'publish.sh'))) throw new Error(`${directory}: publish.sh is obsolete; declare packages in NPMBUILD`);
    lintImplementation(directory, source, file, port);
  }
  return port;
}

export function lintPublishedNames(ports) {
  const names = new Map();
  for (const port of ports) {
    if (names.has(port.pkgname) && names.get(port.pkgname) !== port.upstream) {
      throw new Error(`Published short name ${port.pkgname} maps to multiple upstream packages: ${names.get(port.pkgname)}, ${port.upstream}`);
    }
    names.set(port.pkgname, port.upstream);
  }
}
