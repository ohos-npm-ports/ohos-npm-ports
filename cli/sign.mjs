import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readdirSync, readSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

const defaultSelfsign = '/storage/Users/currentUser/.harmonybrew/opt/ohos-selfsign/bin/selfsign';

function isAarch64Elf(file) {
  const descriptor = openSync(file, 'r');
  try {
    const header = Buffer.alloc(20);
    if (readSync(descriptor, header, 0, header.length, 0) !== header.length) return false;
    if (header[0] !== 0x7f || header[1] !== 0x45 || header[2] !== 0x4c || header[3] !== 0x46) return false;
    if (header[5] === 1) return header.readUInt16LE(18) === 183;
    if (header[5] === 2) return header.readUInt16BE(18) === 183;
    return false;
  } finally {
    closeSync(descriptor);
  }
}

export function findAarch64ElfFiles(directories) {
  const files = [];
  function scan(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) scan(path);
      else if (entry.isFile() && isAarch64Elf(path)) files.push(path);
    }
  }
  for (const directory of directories) scan(directory);
  return files.sort();
}

export function signPackages(staged, { command = defaultSelfsign, execute = execFileSync } = {}) {
  if (!isAbsolute(command)) throw new Error(`selfsign command must be an absolute path: ${command}`);
  if (!existsSync(command)) throw new Error(`selfsign is not installed at ${command}`);
  const files = findAarch64ElfFiles(staged.map(({ directory }) => directory));
  for (const file of files) execute(command, ['--force', file], { stdio: ['ignore', 'inherit', 'inherit'] });
  console.log(`Signed ${files.length} AArch64 ELF file(s) with ${command}`);
  return files;
}
