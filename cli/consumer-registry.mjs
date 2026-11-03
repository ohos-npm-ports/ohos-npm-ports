import { join } from 'node:path';

export function registryConfig(temporary, address, artifacts) {
  const policy = [...new Set(artifacts.map((pkg) => pkg.name))].map((name) =>
    `  ${JSON.stringify(name)}:\n    access: $all\n    publish: $authenticated\n`).join('');
  return `storage: ${JSON.stringify(join(temporary, 'storage'))}\nlisten: ${address}\nmax_body_size: 256mb\nauth:\n  htpasswd:\n    file: ${JSON.stringify(join(temporary, 'htpasswd'))}\n    max_users: 1\nuplinks:\n  npmjs:\n    url: https://registry.npmjs.org/\npackages:\n${policy}  '**':\n    access: $all\n    publish: $authenticated\n    proxy: npmjs\n`;
}

export function artifactsForPort(artifacts, dir) {
  return artifacts.filter((artifact) => artifact.portDir === dir);
}
