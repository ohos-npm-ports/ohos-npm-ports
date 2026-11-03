import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverPorts, loadPort } from '../../cli/port.mjs';
import { publishedIntegrity } from '../../cli/registry.mjs';
import { closure, testSpec } from '../../cli/consumer-test.mjs';

export { closure, testSpec } from '../../cli/consumer-test.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const excluded = JSON.parse(readFileSync(join(repo, '.github/fixtures/consumer/excluded-ports.json'), 'utf8'));
export const infrastructure = JSON.parse(readFileSync(join(repo, '.github/fixtures/consumer/infrastructure.json'), 'utf8'));
const listed = (entries) => (file) => !file.endsWith('.md')
  && entries.some((entry) => entry.endsWith('/') ? file.startsWith(entry) : file === entry);
export const isInfrastructure = listed(infrastructure);
// The part of the infrastructure that changes what a build produces; a subset of `infrastructure`. Everything
// else in it only changes how built tarballs are tested, so ports whose own files did not change are not rebuilt.
export const buildInfrastructure = JSON.parse(readFileSync(join(repo, '.github/fixtures/consumer/build-infrastructure.json'), 'utf8'));
export const isBuildInfrastructure = listed(buildInfrastructure);
// Ports that stand in for the whole repository when only infrastructure changed.
export const sentinels = JSON.parse(readFileSync(join(repo, '.github/fixtures/consumer/sentinel-ports.json'), 'utf8'));
const isExcluded = (dir) => Object.hasOwn(excluded, basename(dir));
const ports = new Map();
function port(dir) {
  if (!ports.has(dir)) ports.set(dir, loadPort(repo, dir));
  return ports.get(dir);
}

function allPortDirs() {
  return discoverPorts(repo).map((dir) => relative(repo, dir).split('/').join('/'));
}

function allTests() {
  return allPortDirs().filter((dir) => !isExcluded(dir) && existsSync(join(repo, dir, 'test.mjs')) && testSpec(dir).role === 'primary');
}

export function artifactPattern(port) {
  const names = closure([port]).map((dir) => `port-${basename(dir)}`);
  return names.length === 1 ? names[0] : `{${names.join(',')}}`;
}

// A port needs publishing when its main package version is absent from npm. Judging by the registry instead of
// by the diff makes publishing self-healing: a version whose earlier run failed is picked up by the next push,
// and edits that leave the version alone (CI, test.mjs, mass renames) never try to publish over it.
// PUBLISHED_PACKAGES (a JSON array of "name@version") replaces the registry lookup in tests.
export function missingFromRegistry(dirs, { published = process.env.PUBLISHED_PACKAGES, lookup = publishedIntegrity } = {}) {
  const known = published ? new Set(JSON.parse(published)) : null;
  return dirs.filter((dir) => {
    const { pkgname, portVersion } = port(dir);
    const name = `@ohos-npm-ports/${pkgname}`;
    return known ? !known.has(`${name}@${portVersion}`) : lookup(name, portVersion) === null;
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2] === 'artifact-pattern') {
  console.log(artifactPattern(process.argv[3]));
} else if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const changed = readFileSync(0, 'utf8').trim().split('\n').filter(Boolean);
  const dirs = [...new Set(changed.filter((file) => file.startsWith('ports/')).map((file) => file.split('/').slice(0, 3).join('/')))]
    .filter((dir) => existsSync(join(repo, dir, 'NPMBUILD')) && !isExcluded(dir));
  if (process.env.BUILD_ALL === 'true') dirs.push(...allPortDirs());
  for (const [port, reason] of Object.entries(excluded)) console.error(`::notice::Excluded port ${port}: ${reason}`);
  const infrastructureChanged = changed.some(isInfrastructure);
  const candidates = allTests();
  const affected = candidates.filter((dir) => closure([dir]).some((input) => dirs.includes(input)));
  // Infrastructure edits test only the sentinels. On a push, ports whose version npm lacks are added so that
  // publishing still heals itself.
  const healing = process.env.PUBLISH_CHECK === 'true' && infrastructureChanged ? missingFromRegistry(allPortDirs().filter((dir) => !isExcluded(dir) && existsSync(join(repo, dir, 'NPMBUILD')))) : [];
  const selected = process.env.BUILD_ALL === 'true'
    ? allPortDirs()
    : [...new Set([...affected, ...(infrastructureChanged ? sentinels : []), ...healing])];
  if (process.env.CONSUMER_SELECTION) {
    const requested = JSON.parse(process.env.CONSUMER_SELECTION);
    assert.ok(Array.isArray(requested) && requested.length > 0, 'Consumer selection must be a nonempty JSON array');
    assert.equal(new Set(requested).size, requested.length, 'Duplicate consumer selection');
    for (const dir of requested) assert.ok(candidates.includes(dir), `Unknown/non-primary consumer: ${dir}`);
    selected.splice(0, selected.length, ...requested);
  }
  const expanded = closure(selected);
  const tests = selected.filter((dir) => testSpec(dir)?.role === 'primary');
  const matrix = [...new Set([...dirs, ...expanded])].sort();
  // The matrix lists every port that needs tarballs; build-matrix is the part that must be built, the rest is
  // fetched from npm. Without REGISTRY_CHECK nothing is known about npm, so everything is built.
  const sourceChanged = (dir) => changed.some((file) => file.startsWith(`${dir}/`) && file !== `${dir}/test.mjs`);
  const buildAll = process.env.REGISTRY_CHECK !== 'true' || process.env.BUILD_ALL === 'true' || changed.some(isBuildInfrastructure);
  const missing = buildAll && process.env.PUBLISH_CHECK !== 'true' ? [] : missingFromRegistry(matrix);
  const buildMatrix = buildAll ? matrix : matrix.filter((dir) => sourceChanged(dir) || missing.includes(dir));
  console.log(`matrix=${JSON.stringify(matrix)}`);
  console.log(`build-matrix=${JSON.stringify(buildMatrix)}`);
  console.log(`fetch-matrix=${JSON.stringify(matrix.filter((dir) => !buildMatrix.includes(dir)))}`);
  const publish = process.env.PUBLISH_CHECK === 'true' ? missing : [];
  console.log(`publish=${JSON.stringify(publish)}`);
  // Prerequisites first, so a port is never on npm before the ports its install depends on.
  const publishing = new Set(publish);
  console.log(`publish-order=${JSON.stringify(closure(publish).filter((dir) => publishing.has(dir)))}`);
  console.log(`generic-enabled=${matrix.length > 0 || Boolean(process.env.ARTIFACT_RUN_ID)}`);
  console.log(`generic-ports=${JSON.stringify(matrix)}`);
  console.log(`consumer-enabled=${tests.length > 0}`);
  console.log(`consumer-ports=${JSON.stringify(tests)}`);
}
