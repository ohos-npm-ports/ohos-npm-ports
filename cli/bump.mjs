import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { compareSemver, inVersionLine, parseSemver } from './semver.mjs';
import { npmCommand } from './build.mjs';

function metadata(port, registry) {
  const args = ['view', port.upstream, 'dist-tags', 'versions', '--json'];
  if (registry) args.push('--registry', registry);
  const output = execFileSync(npmCommand, args, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  return JSON.parse(output);
}

function latestVersion(port, data) {
  if (!port.versionLine) {
    const version = data['dist-tags']?.[port.upstreamTag];
    if (!version) throw new Error(`${port.name}: no ${port.upstreamTag} dist-tag for ${port.upstream}`);
    return version;
  }
  const current = parseSemver(port.version);
  return (data.versions ?? []).filter((version) => {
    try {
      return inVersionLine(version, port.versionLine)
        && (current.prerelease.length > 0 || parseSemver(version).prerelease.length === 0);
    } catch { return false; }
  }).sort(compareSemver).at(-1) ?? null;
}

export async function downloadSha256(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Source download failed (${response.status}): ${url}`);
  const data = Buffer.from(await response.arrayBuffer());
  return createHash('sha256').update(data).digest('hex');
}

function assignment(source, key) {
  const pattern = new RegExp(`^${key}=((?:\"[^\"]*\"|'[^']*'|[^\\s#]+))`, 'm');
  const match = pattern.exec(source);
  if (!match) throw new Error(`NPMBUILD is missing ${key}`);
  return match[1];
}

function replaceAssignment(source, key, value) {
  const pattern = new RegExp(`^${key}=(?:\"[^\"]*\"|'[^']*'|[^\\s#]+)`, 'm');
  if (!pattern.test(source)) throw new Error(`NPMBUILD is missing ${key}`);
  return source.replace(pattern, key === 'revision' ? `${key}=${value}` : `${key}="${value}"`);
}

function tokenValue(token) {
  if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) return token.slice(1, -1);
  return token;
}

function hasVersionReference(value) {
  return value.includes('${version}') || /\$version(?![A-Za-z0-9_])/.test(value);
}

export function resourceDeclarations(source) {
  const declarations = [...source.matchAll(/^resource "([a-z][a-z0-9_]*)" \\\n  "([^"\n]+)" \\\n  "([a-f0-9]{64})"$/gm)]
    .map((match) => ({ name: match[1], url: match[2], sha256: match[3], text: match[0] }));
  const calls = source.match(/^resource\s/gm) ?? [];
  if (declarations.length !== calls.length) throw new Error('resource declarations must use the canonical three-line form');
  return declarations;
}

export function updatePortText(source, values) {
  let result = source;
  for (const key of ['version', 'revision', 'sha256']) {
    if (values[key] !== undefined) result = replaceAssignment(result, key, values[key]);
  }
  if (values.source !== undefined) {
    const current = tokenValue(assignment(result, 'source'));
    if (!hasVersionReference(current)) result = replaceAssignment(result, 'source', values.source);
  }
  for (const update of values.resources ?? []) {
    const declaration = resourceDeclarations(result).find(({ name }) => name === update.name);
    if (!declaration) throw new Error(`NPMBUILD is missing resource ${update.name}`);
    if (!hasVersionReference(declaration.url)) throw new Error(`resource ${update.name} does not reference version`);
    const text = `resource "${update.name}" \\\n  "${declaration.url}" \\\n  "${update.sha256}"`;
    result = result.replace(declaration.text, text);
  }
  return result;
}

async function changeFor(port, registry, metadataFor, download) {
  const version = latestVersion(port, await metadataFor(port, registry));
  if (!version || compareSemver(version, port.version) <= 0) return null;
  const text = readFileSync(`${port.dir}/NPMBUILD`, 'utf8');
  const hashes = new Map();
  const shaFor = (url) => {
    if (!hashes.has(url)) hashes.set(url, Promise.resolve(download(url)));
    return hashes.get(url);
  };
  let source;
  let sha256;
  if (port.source) {
    const template = tokenValue(assignment(text, 'source'));
    if (!hasVersionReference(template) && !template.includes(port.version)) {
      throw new Error('source must reference ${version} for automatic bump');
    }
    source = port.source.split(port.version).join(version);
    sha256 = await shaFor(source);
  }
  const resources = [];
  for (const declaration of resourceDeclarations(text)) {
    if (!hasVersionReference(declaration.url)) continue;
    const current = port.resources.find(({ name }) => name === declaration.name);
    if (!current) throw new Error(`resource metadata is missing ${declaration.name}`);
    const url = current.url.split(port.version).join(version);
    resources.push({ name: declaration.name, url, sha256: await shaFor(url) });
  }
  return { version, revision: '1', source, sha256, resources };
}

export async function bumpPorts(root, ports, {
  write = false,
  registry = '',
  output = '',
  metadata: metadataFor = metadata,
  download = downloadSha256,
} = {}) {
  const changed = [];
  const errors = [];
  for (const port of ports) {
    try {
      if (!port.bump) {
        console.log(`${port.name}: automatic bump disabled`);
        continue;
      }
      const change = await changeFor(port, registry, metadataFor, download);
      if (!change) {
        console.log(`${port.name}: up to date (${port.version}-${port.revision})`);
        continue;
      }
      console.log(`${port.name}: ${port.version} -> ${change.version}${write ? '' : ' (dry run)'}`);
      changed.push({ port, ...change });
      if (!write) continue;
      const file = `${port.dir}/NPMBUILD`;
      const text = updatePortText(readFileSync(file, 'utf8'), change);
      writeFileSync(file, text);
    } catch (error) {
      errors.push(`${port.name}: ${error.message}`);
      console.error(`${errors.at(-1)}`);
    }
  }
  if (output) {
    appendFileSync(output, `changed=${changed.length > 0}\n`);
    appendFileSync(output, `ports=${JSON.stringify(changed.map(({ port }) => port.name))}\n`);
    if (changed.length === 1) appendFileSync(output, `version=${changed[0].version}\n`);
    appendFileSync(output, `summary<<NPM_PORTS_EOF\n${changed.map(({ port, version }) => `- ${port.name}: ${port.version} → ${version}-1`).join('\n')}\nNPM_PORTS_EOF\n`);
  }
  if (errors.length) throw new Error(`Bump failed:\n${errors.join('\n')}`);
  return changed;
}
