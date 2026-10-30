import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSemver } from './semver.mjs';

export const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = fileURLToPath(new URL('./runtime.sh', import.meta.url));

export function findRoot(start = process.cwd()) {
  if (process.env.NPM_PORTS_ROOT) return resolve(process.env.NPM_PORTS_ROOT);
  let directory = resolve(start);
  while (true) {
    if (existsSync(join(directory, 'ports')) && existsSync(join(directory, 'cli', 'npm-ports'))) return directory;
    const parent = dirname(directory);
    if (parent === directory) return defaultRoot;
    directory = parent;
  }
}

export function portPath(root, input) {
  if (!input) throw new Error('A port name or directory is required');
  const direct = resolve(input);
  const scopedInput = input.includes('/') ? input : `${input[0]}/${input}`;
  const candidate = existsSync(join(direct, 'NPMBUILD')) ? direct : resolve(root, 'ports', scopedInput);
  if (!existsSync(join(candidate, 'NPMBUILD'))) throw new Error(`NPMBUILD not found: ${input}`);
  const ports = resolve(root, 'ports');
  const inside = relative(ports, candidate).split(sep);
  if (inside.length !== 2 || inside[0] !== basename(candidate)[0]) throw new Error(`Port must be ports/<letter>/<name>: ${input}`);
  return candidate;
}

export function discoverPorts(root) {
  const ports = join(root, 'ports');
  if (!existsSync(ports)) return [];
  return readdirSync(ports, { withFileTypes: true }).flatMap((letter) => {
    if (!letter.isDirectory()) return [];
    return readdirSync(join(ports, letter.name), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(ports, letter.name, entry.name, 'NPMBUILD')))
      .map((entry) => join(ports, letter.name, entry.name));
  }).sort();
}

const readScript = [
  'set -euo pipefail',
  'export NPMBUILD_DIR="$1"',
  'source "$NPM_PORTS_RUNTIME"',
  'source "$NPMBUILD_DIR/NPMBUILD" >&2',
  ': "${pkgname:?pkgname is required}"',
  ': "${upstream:?upstream is required}"',
  ': "${version:?version is required}"',
  ': "${revision:?revision is required}"',
  ': "${dist_tag:?dist_tag is required}"',
  'if ! declare -F build >/dev/null; then',
  "  echo 'build() is required' >&2",
  '  exit 65',
  'fi',
  'printf \'%s\\0\' "$pkgname" "$upstream" "$version" "$revision" "$dist_tag" \\',
  '  "${upstream_tag:-latest}" "${source:-}" "${sha256:-}" "${bump:-true}"',
  'printf \'%s\\0\' "${#packages[@]}"',
  'for output in "${packages[@]}"; do printf \'%s\\0\' "$output"; done',
  'printf \'%s\\0\' "${#resource_names[@]}"',
  'if [ "${#resource_names[@]}" -gt 0 ]; then',
  '  for resource_name in "${resource_names[@]}"; do',
  '    url_variable="resource_${resource_name}_url"',
  '    sha_variable="resource_${resource_name}_sha256"',
  '    printf \'%s\\0\' "$resource_name" "${!url_variable}" "${!sha_variable}"',
  '  done',
  'fi',
].join('\n');

export function loadPort(root, input) {
  const dir = portPath(root, input);
  const output = execFileSync('bash', ['-c', readScript, 'npm-ports', dir], {
    cwd: dir,
    env: { ...process.env, NPMBUILD_DIR: dir, NPM_PORTS_RUNTIME: runtime },
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  const fields = output.split('\0');
  const [pkgname, upstream, version, revisionText, distTag, upstreamTag, source, sha256, bump, countText] = fields;
  const count = Number(countText);
  if (!Number.isInteger(count) || count < 1 || fields.length < 12 + count) throw new Error(`Invalid packages array: ${dir}`);
  const resourceOffset = 10 + count;
  const resourceCount = Number(fields[resourceOffset]);
  if (!Number.isInteger(resourceCount) || resourceCount < 0 || fields.length !== 12 + count + resourceCount * 3) {
    throw new Error(`Invalid resources array: ${dir}`);
  }
  const resources = [];
  for (let index = 0; index < resourceCount; index += 1) {
    const offset = resourceOffset + 1 + index * 3;
    resources.push({ name: fields[offset], url: fields[offset + 1], sha256: fields[offset + 2] });
  }
  const name = basename(dir);
  const separator = name.indexOf('@');
  const baseName = separator === -1 ? name : name.slice(0, separator);
  const versionLine = separator === -1 ? '' : name.slice(separator + 1);
  const port = {
    name,
    baseName,
    versionLine,
    dir,
    relative: relative(root, dir).split(sep).join('/'),
    pkgname,
    upstream,
    version,
    revision: Number(revisionText),
    portVersion: `${version}-${revisionText}`,
    distTag,
    upstreamTag,
    source,
    sha256,
    bump: bump !== 'false',
    packages: fields.slice(10, 10 + count),
    resources,
  };
  validatePort(port);
  return port;
}

export function validatePort(port) {
  const fail = (message) => { throw new Error(`${port.relative}: ${message}`); };
  if (!/^[a-z0-9][a-z0-9._-]*(?:@\d+(?:\.\d+){0,2})?$/.test(port.name)) fail('invalid port name');
  if (port.baseName !== port.pkgname) fail(`pkgname must be ${port.baseName}`);
  if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(port.upstream)) fail('invalid upstream npm package');
  const parsed = parseSemver(port.version);
  if (port.versionLine) {
    const actual = [parsed.major, parsed.minor, parsed.patch];
    if (port.versionLine.split('.').some((part, index) => Number(part) !== actual[index])) fail(`version ${port.version} is outside @${port.versionLine}`);
  }
  if (!Number.isInteger(port.revision) || port.revision < 1) fail('revision must be a positive integer');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(port.distTag)) fail('invalid dist_tag');
  if (port.versionLine && port.distTag === 'latest') fail('versioned ports must not publish to latest');
  if (port.source && !/^https:\/\//.test(port.source)) fail('source must use https');
  if (port.sha256 && !/^[a-f0-9]{64}$/.test(port.sha256)) fail('sha256 must contain 64 lowercase hex characters');
  if (Boolean(port.source) !== Boolean(port.sha256)) fail('source and sha256 must be declared together');
  const resourceNames = new Set();
  for (const resource of port.resources) {
    if (!/^[a-z][a-z0-9_]*$/.test(resource.name)) fail(`invalid resource name: ${resource.name}`);
    if (resourceNames.has(resource.name)) fail(`duplicate resource: ${resource.name}`);
    resourceNames.add(resource.name);
    if (!/^https:\/\//.test(resource.url)) fail(`resource ${resource.name} must use https`);
    if (!/^[a-f0-9]{64}$/.test(resource.sha256)) fail(`resource ${resource.name} requires a SHA-256`);
  }
  if (new Set(port.packages).size !== port.packages.length) fail('duplicate package output');
  for (const output of port.packages) {
    if (!output || isAbsolute(output) || output.split('/').includes('..')) fail(`unsafe package output: ${output}`);
  }
  return port;
}
