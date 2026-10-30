import { execFileSync } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// Returns the registry's dist.integrity for name@version, or null when that exact version is not published.
// Only a clear E404 means "not published": network, auth and registry failures throw, so callers never
// mistake an outage for a missing version.
export function publishedIntegrity(name, version, { registry = '', exec = execFileSync } = {}) {
  const args = ['view', `${name}@${version}`, 'dist.integrity', '--json'];
  if (registry) args.push('--registry', registry);
  let output;
  try {
    output = exec(npmCommand, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    if (/\bE404\b/.test(`${error.stdout ?? ''}${error.stderr ?? ''}`)) return null;
    throw new Error(`npm view ${name}@${version} failed: ${error.stderr || error.message}`);
  }
  const integrity = output.trim() ? JSON.parse(output) : null;
  if (typeof integrity !== 'string' || !integrity.startsWith('sha512-')) {
    throw new Error(`npm view ${name}@${version} returned no sha512 integrity`);
  }
  return integrity;
}
