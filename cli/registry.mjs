import { execFileSync } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// Runs `npm view <spec> <field> --json` and returns the parsed value (null for an empty answer), or undefined when
// the registry answers E404.
// Only a clear E404 means "not published": network, auth and registry failures throw, so callers never
// mistake an outage for a missing version.
function view(spec, field, { registry = '', exec = execFileSync } = {}) {
  const args = ['view', spec, field, '--json'];
  if (registry) args.push('--registry', registry);
  let output;
  try {
    output = exec(npmCommand, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    if (/\bE404\b/.test(`${error.stdout ?? ''}${error.stderr ?? ''}`)) return undefined;
    throw new Error(`npm view ${spec} failed: ${error.stderr || error.message}`);
  }
  return output.trim() ? JSON.parse(output) : null;
}

// Returns the registry's dist.integrity for name@version, or null when that exact version is not published.
export function publishedIntegrity(name, version, options) {
  const integrity = view(`${name}@${version}`, 'dist.integrity', options);
  if (integrity === undefined) return null;
  if (typeof integrity !== 'string' || !integrity.startsWith('sha512-')) {
    throw new Error(`npm view ${name}@${version} returned no sha512 integrity`);
  }
  return integrity;
}

// Returns the version a dist-tag points at, or null when the package or the tag does not exist.
export function distTagVersion(name, tag, options) {
  const tags = view(name, 'dist-tags', options);
  return tags && typeof tags[tag] === 'string' ? tags[tag] : null;
}
