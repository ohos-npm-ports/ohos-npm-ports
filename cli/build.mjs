import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { distTagVersion, publishedIntegrity } from './registry.mjs';
import { compareSemver } from './semver.mjs';
import { signPackages } from './sign.mjs';

export const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const portScope = '@ohos-npm-ports/';
const runtime = fileURLToPath(new URL('./runtime.sh', import.meta.url));

function run(command, args, options = {}) {
  return execFileSync(command, args, { stdio: ['ignore', 'inherit', 'inherit'], ...options });
}

function sourceSha(root) {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  return run('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
}

function updateSlotReferences(pkg, versions) {
  for (const field of ['dependencies', 'optionalDependencies']) {
    for (const [name, range] of Object.entries(pkg[field] ?? {})) {
      if (typeof range !== 'string') continue;
      if (range.startsWith('npm:')) {
        const alias = range.slice(4);
        const separator = alias.lastIndexOf('@');
        if (separator > 0 && versions.has(alias.slice(0, separator))) {
          pkg[field][name] = `npm:${alias.slice(0, separator)}@${versions.get(alias.slice(0, separator))}`;
        }
      } else if (versions.has(name)) {
        pkg[field][name] = versions.get(name);
      }
    }
  }
}

export function stagePackages(port) {
  const staged = port.packages.map((output) => {
    const directory = resolve(port.dir, output);
    const file = join(directory, 'package.json');
    if (!existsSync(file)) throw new Error(`${port.relative}: missing package manifest: ${output}/package.json`);
    const pkg = JSON.parse(readFileSync(file, 'utf8'));
    if (!pkg.name?.startsWith(portScope)) throw new Error(`${port.relative}: ${output} has invalid package name ${pkg.name}`);
    if (pkg.version !== port.version) {
      throw new Error(`${port.relative}: ${pkg.name}@${pkg.version} must retain upstream ${port.version}; revision is injected only while packing`);
    }
    return { output, directory, file, pkg };
  });
  const names = staged.map(({ pkg }) => pkg.name);
  if (new Set(names).size !== names.length) throw new Error(`${port.relative}: duplicate published package name`);
  const mainName = `${portScope}${port.pkgname}`;
  if (!names.includes(mainName)) throw new Error(`${port.relative}: outputs do not contain ${mainName}`);
  const versions = new Map(names.map((name) => [name, port.portVersion]));
  for (const { pkg, file } of staged) {
    pkg.version = port.portVersion;
    updateSlotReferences(pkg, versions);
    const repository = typeof pkg.repository === 'object' && pkg.repository !== null ? pkg.repository : {};
    pkg.repository = {
      ...repository,
      type: repository.type ?? 'git',
      url: repository.url ?? 'git+https://github.com/ohos-npm-ports/ohos-npm-ports.git',
      directory: port.relative,
    };
    writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  }
  console.log(`Staged ${names.map((name) => `${name}@${port.portVersion}`).join(', ')}`);
  return staged;
}

function buildEnvironment(port) {
  const env = {
    ...process.env,
    NPMBUILD_DIR: port.dir,
    NPMBUILD_VERSION: port.version,
    NPM_PORTS_RUNTIME: runtime,
  };
  try {
    const prefix = execFileSync('brew', ['--prefix', 'python'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const pythonBin = join(prefix, 'libexec', 'bin');
    if (existsSync(join(pythonBin, 'python'))) {
      env.PYTHON ??= join(pythonBin, 'python');
      env.PATH = `${pythonBin}:${env.PATH ?? ''}`;
    }
  } catch { /* Non-brew hosts keep their existing Python configuration. */ }
  return env;
}

function components(port) {
  const slots = [...new Set(port.packages.filter((output) => output.startsWith('slots/')).map((output) => output.split('/')[1]))];
  return [
    { name: 'main', directory: port.dir, prefix: '' },
    ...slots.map((slot) => ({
      name: slot,
      directory: join(port.dir, 'slots', slot),
      prefix: `slot_${slot.replace(/[^A-Za-z0-9]/g, '_')}_`,
    })),
  ];
}

function runHooks(port, component, phases) {
  const hooks = phases.map((phase) => `${component.prefix}${phase}`);
  const script = [
    'set -e',
    'source "$NPM_PORTS_RUNTIME"',
    'source "$NPMBUILD_DIR/NPMBUILD"',
    ...hooks.flatMap((hook) => [
      `if declare -F ${hook} >/dev/null; then`,
      ...(hook.endsWith('package') ? ['  cd "$NPMBUILD_SLOT_DIR"'] : []),
      `  ${hook}`,
      'fi',
    ]),
  ].join('\n');
  console.log(`==> ${port.relative}${component.name === 'main' ? '' : `/${component.name}`}: ${phases.join(' -> ')}`);
  run('bash', ['-c', script], {
    cwd: component.directory,
    env: { ...buildEnvironment(port), NPMBUILD_SLOT: component.name, NPMBUILD_SLOT_DIR: component.directory },
  });
}

export function runLifecycle(port, through = 'check') {
  const phases = ['prepare', 'build', 'package', 'check'];
  if (!phases.includes(through)) throw new Error(`Unknown lifecycle phase: ${through}`);
  const selected = phases.slice(0, phases.indexOf(through) + 1);
  for (const component of components(port)) runHooks(port, component, selected);
}

export function buildPort(port) {
  return runLifecycle(port, 'build');
}

export function packagePort(port) {
  return runLifecycle(port, 'package');
}

export function checkPort(port) {
  return runLifecycle(port, 'check');
}

export function packPort(root, port, { build = true, signer = signPackages } = {}) {
  if (build) checkPort(port);
  const staged = stagePackages(port);
  signer(staged);
  const artifacts = join(port.dir, 'artifacts');
  rmSync(artifacts, { recursive: true, force: true });
  mkdirSync(artifacts, { recursive: true });
  const packages = staged.map(({ directory }) => {
    const output = run(npmCommand, ['pack', directory, '--ignore-scripts', '--json', '--pack-destination', artifacts], {
      cwd: port.dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
      maxBuffer: 10 * 1024 * 1024,
    });
    const result = JSON.parse(output);
    if (!Array.isArray(result) || result.length !== 1) throw new Error(`Unexpected npm pack result for ${directory}`);
    const [{ name, version, filename, integrity }] = result;
    if (version !== port.portVersion || basename(filename) !== filename) throw new Error(`Unsafe npm pack result for ${name}`);
    return { name, version, filename, integrity };
  });
  const manifest = { sourceSha: sourceSha(root), portDir: port.relative, packages };
  writeFileSync(join(artifacts, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Packed ${packages.length} package(s) in ${join(port.relative, 'artifacts')}`);
  return manifest;
}

export function readManifest(port) {
  const file = join(port.dir, 'artifacts', 'manifest.json');
  if (!existsSync(file)) throw new Error(`${port.relative}: artifacts/manifest.json is missing; run npm-ports pack first`);
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  if (manifest.portDir !== port.relative || !Array.isArray(manifest.packages) || manifest.packages.length === 0) {
    throw new Error(`${port.relative}: stale or invalid artifact manifest`);
  }
  const names = new Set();
  for (const pkg of manifest.packages) {
    if (!pkg.name?.startsWith(portScope)) throw new Error(`${port.relative}: invalid package scope in artifacts: ${pkg.name}`);
    if (names.has(pkg.name)) throw new Error(`${port.relative}: duplicate package in artifacts: ${pkg.name}`);
    names.add(pkg.name);
    if (pkg.version !== port.portVersion) throw new Error(`${port.relative}: artifacts contain ${pkg.version}, expected ${port.portVersion}`);
  }
  if (!names.has(`${portScope}${port.pkgname}`)) throw new Error(`${port.relative}: main package is missing from artifacts`);
  return manifest;
}

function recordPackage(pkg) {
  if (!process.env.PACKAGE_LIST) return;
  appendFileSync(process.env.PACKAGE_LIST, `${pkg.name}@${pkg.version}\n`);
}

// Slot packages go first and the main package last: if a publish stops half-way, `latest` never points at a
// main package whose platform slots are missing.
function publishOrder(port, packages) {
  const main = `${portScope}${port.pkgname}`;
  return [...packages.filter((pkg) => pkg.name !== main), ...packages.filter((pkg) => pkg.name === main)];
}

// With skipExisting, a version that is already on the registry is skipped when its integrity matches the
// artifact (a rerun) and is an error when it differs (the same version number holds other content).
function alreadyPublished(pkg, { registry, lookup }) {
  const existing = lookup(pkg.name, pkg.version, { registry });
  if (existing === null) return false;
  if (existing !== pkg.integrity) {
    throw new Error(`${pkg.name}@${pkg.version} is already published with different content (${existing}, artifact ${pkg.integrity}); bump the revision`);
  }
  console.log(`::notice::${pkg.name}@${pkg.version} is already published with identical content; skipping`);
  return true;
}

// A publish that finishes late (an older run, a rerun) must not pull a dist-tag back to an older version: when the
// tag already names a newer version, the older one is published under `stale` instead.
export const staleTag = 'stale';
export function chooseTag(distTag, version, currentVersion) {
  return currentVersion && compareSemver(currentVersion, version) > 0 ? staleTag : distTag;
}

// skipExisting is the rerun-safe mode used by CI: versions already on the registry are skipped (or rejected when
// their content differs) and a dist-tag is never moved backwards. expectSha requires the artifacts to come from
// that commit, so only tarballs built and verified in the current run can be published.
export function publishPort(port, { dryRun = false, registry = '', skipExisting = false, expectSha = '', lookup = publishedIntegrity, tagLookup = distTagVersion } = {}) {
  const manifest = readManifest(port);
  if (expectSha && manifest.sourceSha !== expectSha) {
    throw new Error(`${port.relative}: artifacts were built from ${manifest.sourceSha}, expected ${expectSha}`);
  }
  for (const pkg of publishOrder(port, manifest.packages)) {
    const tarball = join(port.dir, 'artifacts', pkg.filename);
    if (!existsSync(tarball) || basename(pkg.filename) !== pkg.filename) throw new Error(`Missing or unsafe artifact: ${pkg.filename}`);
    const integrity = `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`;
    if (integrity !== pkg.integrity) throw new Error(`Artifact integrity mismatch: ${pkg.filename}`);
    if (skipExisting && alreadyPublished(pkg, { registry, lookup })) continue;
    const tag = skipExisting ? chooseTag(port.distTag, pkg.version, tagLookup(pkg.name, port.distTag, { registry })) : port.distTag;
    if (tag !== port.distTag) console.log(`::notice::${pkg.name} tag ${port.distTag} already names a newer version; publishing ${pkg.version} as ${tag}`);
    console.log(`${dryRun ? 'Would publish' : 'Publishing'} ${pkg.name}@${pkg.version} (${pkg.filename}) with tag ${tag}`);
    if (dryRun) {
      recordPackage(pkg);
      continue;
    }
    const args = ['publish', tarball, '--access', 'public', '--tag', tag];
    if (registry) args.push('--registry', registry);
    try {
      run(npmCommand, args, { cwd: port.dir });
    } catch (error) {
      // Another run may have published the same version between the check and the publish.
      if (!skipExisting || !alreadyPublished(pkg, { registry, lookup })) throw error;
      continue;
    }
    recordPackage(pkg);
  }
}
