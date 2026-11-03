import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function run(command, args = [], options = {}) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) throw new TypeError('run args must be a string array');
  const capture = options.capture === true;
  const env = { ...process.env };
  for (const [name, value] of Object.entries(options.env ?? {})) {
    if (value === undefined || value === null) delete env[name];
    else env[name] = String(value);
  }
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env,
    input: options.input,
    timeout: options.timeout,
    encoding: 'utf8',
    maxBuffer: options.maxBuffer ?? 20 * 1024 * 1024,
    stdio: [options.input === undefined ? 'inherit' : 'pipe', capture ? 'pipe' : 'inherit', capture ? 'pipe' : 'inherit'],
  });
  if (result.error) throw result.error;
  const normalized = { code: result.status, signal: result.signal, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  const allowed = options.allowExitCodes ?? [0];
  if (!allowed.includes(normalized.code)) throw new Error(`${command} ${args.join(' ')} failed: ${normalized.stderr || normalized.stdout || normalized.signal || normalized.code}`);
  return normalized;
}

export async function executeConsumerTest({
  file,
  phase = 'test',
  mode = 'local',
  primary = true,
  report = '',
  projectDir = process.cwd(),
  portVersion = '',
  npmCli = '',
  helper = '',
}) {
  assert.ok(['setup', 'test'].includes(phase), `Unknown test phase: ${phase}`);
  const projectRequire = createRequire(resolve(projectDir, 'package.json'));
  const tools = phase === 'setup' ? null : createRequire(projectRequire.resolve('consumer-deps/package.json'));
  const requirePackage = (specifier) => projectRequire(specifier);
  const resolvePackage = (specifier) => projectRequire.resolve(specifier);
  const context = {
    mode,
    primary,
    projectDir,
    portVersion,
    npmCli,
    helper,
    tools,
    run,
    requirePackage,
    resolvePackage,
    importPackage: async (specifier) => import(pathToFileURL(resolvePackage(specifier)).href),
  };
  const testModule = await import(pathToFileURL(resolve(file)).href);
  if (phase === 'setup') {
    if (testModule.setup) await testModule.setup(context);
    return null;
  }
  assert.equal(typeof testModule.default, 'function', `${file} must default-export a test function`);
  const result = await testModule.default(context);
  assert.ok(result && typeof result.result === 'object', `Invalid report from ${file}`);
  result.assets ??= [];
  if (report) writeFileSync(report, JSON.stringify(result));
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file, phase, mode, primary, report] = process.argv.slice(2);
  await executeConsumerTest({
    file,
    phase,
    mode,
    primary: primary === 'true',
    report,
    portVersion: process.env.PORT_TEST_PORT_VERSION,
    npmCli: process.env.PORT_TEST_NPM_CLI,
    helper: process.env.PORT_TEST_HELPER,
  });
}
