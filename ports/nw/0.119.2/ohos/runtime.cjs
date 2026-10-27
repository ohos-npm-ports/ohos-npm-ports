const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createAppServer } = require('./server.cjs');
const { installBridge } = require('./browser.cjs');
const execute = promisify(execFile);
function validateEndpoint(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw Error('Expected a loopback HTTP CDP endpoint with an explicit port');
  return url.origin;
}
function validateVersion(version, endpoint) {
  if (!version.Browser || typeof version['User-Agent'] !== 'string' || !version['User-Agent'].includes('htbrowser/')) throw Error('Expected an installed Haitai browser');
  const websocket = new URL(version.webSocketDebuggerUrl);
  const http = new URL(endpoint);
  if (websocket.protocol !== 'ws:' || !['127.0.0.1', 'localhost'].includes(websocket.hostname) || websocket.port !== http.port || websocket.username || websocket.password)
    throw Error('CDP WebSocket must remain on the configured loopback port');
  return websocket.href;
}
function backend() {
  const playwright = require('@ohos-npm-ports/playwright-core');
  const helpers = require('@ohos-npm-ports/playwright-core/lib/ohos');
  return { playwright, helpers };
}
function verifyBackend() {
  const { playwright } = backend();
  const command = playwright.chromium.executablePath();
  const candidates = path.isAbsolute(command) ? [command] : (process.env.PATH || '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, command));
  if (!candidates.some(candidate => { try { fs.accessSync(candidate, fs.constants.X_OK); return true; } catch { return false; } }))
    throw Error('Local aa is unavailable on PATH');
}
async function connectBrowser(endpoint) {
  const { playwright, helpers } = backend();
  let version;
  try { version = await helpers.httpGetJson(`${endpoint}/json/version`); } catch {}
  if (!version) {
    const config = helpers.resolveLaunchConfig({ channel: 'chrome' });
    if (config.bundleName !== 'com.haitai.htbrowser' || config.kind !== 'tcp') throw Error('This backend requires the installed Haitai browser; check HARMONY_BROWSER');
    const aa = playwright.chromium.executablePath();
    const args = ['start', '-b', config.bundleName, '-a', config.abilityName, '--ps', 'cmdArgs', `--no-first-run --no-default-browser-check --remote-debugging-address=127.0.0.1 --remote-debugging-port=${new URL(endpoint).port}`];
    const result = await execute(aa, args, { timeout: 5000 }).catch(error => {
      if (error.code !== 'ENOEXEC') throw error;
      return execute('sh', [aa, ...args], { timeout: 5000 });
    });
    if (!result.stdout.includes('start ability successfully')) throw Error(`aa start failed: ${result.stdout || result.stderr}`);
    try { await helpers.waitForEndpoint(`${endpoint}/json/version`, 5000); }
    catch (cause) { throw new Error('aa started the browser but local CDP is unavailable. Save and close an existing Haitai instance manually, then retry.', { cause }); }
    version = await helpers.httpGetJson(`${endpoint}/json/version`);
  }
  const websocket = validateVersion(version, endpoint);
  return playwright.chromium.connectOverCDP(websocket, { timeout: 10000 });
}
async function run(options = {}) {
  const appDir = path.resolve(options.srcDir || process.cwd());
  const endpoint = validateEndpoint(options.endpoint || process.env.NWJS_CDP_ENDPOINT || 'http://127.0.0.1:9222');
  let browser, context, app, closing;
  let resolveClosed;
  const closed = new Promise(resolve => { resolveClosed = resolve; });
  const close = () => {
    if (closing) return closing;
    closing = (async () => {
      try { await context?.close(); }
      finally {
        try { await browser?.close(); }
        finally { await app?.close(); resolveClosed(); }
      }
    })();
    return closing;
  };
  app = await createAppServer({ appDir, argv: options.argv || [], onQuit: close });
  try {
    browser = await connectBrowser(endpoint);
    context = await browser.newContext();
    await context.addInitScript(installBridge, app.config);
    const page = await context.newPage();
    context.once('close', () => { if (!closing) void close().catch(() => {}); });
    browser.once('disconnected', () => { if (!closing) void close().catch(() => {}); });
    page.once('close', () => { if (!closing) void close().catch(() => {}); });
    await page.goto(app.entryURL);
    return { page, context, close, closed };
  } catch (error) { await close().catch(() => {}); throw error; }
}
async function cli(args = process.argv.slice(2)) {
  if (args.includes('--help')) {
    console.log('nw [application-directory] [-- application arguments]\nOpenHarmony: installed Haitai + local aa/CDP; restricted Node bridge.\nNWJS_CDP_ENDPOINT defaults to http://127.0.0.1:9222.');
    return;
  }
  const separator = args.indexOf('--');
  const positional = separator < 0 ? args : args.slice(0, separator);
  if (positional.length > 1 || positional.some(value => value.startsWith('-'))) throw Error('Use nw [application-directory] [-- application arguments]; runtime/SDK switches are not supported by this backend');
  const session = await run({ srcDir: positional[0], argv: separator < 0 ? [] : args.slice(separator + 1) });
  const stop = () => { void session.close().catch(error => { console.error(error.message); process.exitCode = 1; }); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try { await session.closed; }
  finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}
module.exports = { run, cli, verifyBackend, validateEndpoint, validateVersion };
