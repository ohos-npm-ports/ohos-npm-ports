import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { npmCommand } from './build.mjs';
import { downloadSha256 } from './bump.mjs';
import { discoverPorts } from './port.mjs';
import { parseSemver } from './semver.mjs';

function render({ pkgname, upstream, version, source, sha256 }) {
  return `${[
    '#!/usr/bin/env bash',
    `pkgname="${pkgname}"`,
    `upstream="${upstream}"`,
    `version="${version}"`,
    'revision=1',
    `source="${source}"`,
    `sha256="${sha256}"`,
    'dist_tag="latest"',
    '',
    'packages=("build/${pkgname}-${version}")',
    '',
    'prepare() {',
    '  extract_source "$NPMBUILD_WORK_DIR/${pkgname}-${version}"',
    '}',
    '',
    'build() {',
    '  cd "$NPMBUILD_WORK_DIR/${pkgname}-${version}"',
    '  # Add OpenHarmony patches and build steps here.',
    '}',
    '',
  ].join('\n')}`;
}

function renderTest({ pkgname, upstream }) {
  return `${[
    "import assert from 'node:assert/strict';",
    "import { readFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    '',
    `const upstream = ${JSON.stringify(upstream)};`,
    `const portPackage = ${JSON.stringify(`@ohos-npm-ports/${pkgname}`)};`,
    '',
    'export default function test({ projectDir, mode, version, revision }) {',
    "  const pkg = JSON.parse(readFileSync(join(projectDir, 'node_modules', ...upstream.split('/'), 'package.json'), 'utf8'));",
    "  assert.equal(pkg.name, mode === 'overrides' ? portPackage : upstream);",
    "  assert.equal(pkg.version, mode === 'overrides' ? `${version}-${revision}` : version);",
    '  // Add real API, CLI, or native-loading checks for this port.',
    '  return { result: { name: pkg.name, version: pkg.version }, assets: [] };',
    '}',
    '',
  ].join('\n')}`;
}

export async function createPort(root, upstream, {
  name = '',
  version = '',
  fetch = true,
  execute = execFileSync,
  download = downloadSha256,
} = {}) {
  if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(upstream)) throw new Error(`Invalid upstream npm package: ${upstream}`);
  const pkgname = name || upstream.replace(/^@/, '').replace('/', '-');
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(pkgname)) throw new Error(`Invalid port name: ${pkgname}`);
  const directory = join(root, 'ports', pkgname[0], pkgname);
  if (existsSync(directory) || discoverPorts(root).some((dir) => basename(dir).split('@')[0] === pkgname)) {
    throw new Error(`${pkgname}: port already exists`);
  }

  let selectedVersion = version;
  let source = `https://registry.npmjs.org/${upstream}/-/${upstream.split('/').at(-1)}-\${version}.tgz`;
  let sha256 = '';
  if (fetch) {
    const output = execute(npmCommand, [
      'view', version ? `${upstream}@${version}` : upstream,
      'name', 'version', 'dist.tarball', '--json',
    ], { encoding: 'utf8' });
    const metadata = JSON.parse(output);
    const tarball = metadata.dist?.tarball ?? metadata['dist.tarball'];
    if (metadata.name !== upstream || !metadata.version || !tarball) {
      throw new Error(`${upstream}: registry returned incomplete or mismatched metadata`);
    }
    selectedVersion = metadata.version;
    const url = new URL(tarball);
    if (url.protocol !== 'https:') throw new Error(`${upstream}: source must use https`);
    source = url.href;
    sha256 = await download(source);
  }
  if (selectedVersion) parseSemver(selectedVersion);

  const file = join(directory, 'NPMBUILD');
  const testFile = join(directory, 'test.mjs');
  mkdirSync(directory, { recursive: true });
  writeFileSync(file, render({ pkgname, upstream, version: selectedVersion, source, sha256 }), { flag: 'wx', mode: 0o755 });
  writeFileSync(testFile, renderTest({ pkgname, upstream }), { flag: 'wx' });
  return {
    dir: directory,
    file,
    testFile,
    relative: relative(root, file).split(sep).join('/'),
    pkgname,
    upstream,
    version: selectedVersion,
    source,
    sha256,
  };
}
