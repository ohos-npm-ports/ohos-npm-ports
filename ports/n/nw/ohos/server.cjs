const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const MAX_BODY = 65536;
function denied(message) { return Object.assign(Error(message), { code: 'EACCES' }); }
function unsupported(message) { return Object.assign(Error(message), { code: 'ERR_NW_UNSUPPORTED' }); }
async function createAppServer({ appDir, argv = [], onQuit = () => {} }) {
  const root = fs.realpathSync(appDir);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (typeof manifest.main !== 'string' || !manifest.main || /^[a-z][a-z\d+.-]*:/i.test(manifest.main) || path.isAbsolute(manifest.main))
    throw unsupported('The manifest must select a local main HTML file');
  for (const name of ['node-main', 'node-remote', 'inject_js_start', 'inject_js_end', 'chromium-args'])
    if (manifest[name] !== undefined) throw unsupported(`Unsupported manifest option: ${name}`);
  for (const name of Object.keys(manifest.window || {}))
    if (name !== 'title') throw unsupported(`Unsupported window option: ${name}`);
  function safePath(input) {
    if (typeof input !== 'string' || input.includes('\0')) throw TypeError('Expected a file path string');
    const resolved = path.resolve(root, input);
    const inside = value => { const rel = path.relative(root, value); return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel); };
    if (!inside(resolved)) throw denied('Path is outside the application root');
    let ancestor = resolved;
    while (true) {
      try { fs.lstatSync(ancestor); break; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw denied('Cannot resolve the application path');
      ancestor = parent;
    }
    if (!inside(fs.realpathSync(ancestor))) throw denied('Symlink escapes the application root');
    return resolved;
  }
  const mainPath = safePath(manifest.main.split(/[?#]/)[0]);
  if (!fs.statSync(mainPath).isFile() || !/\.html?$/i.test(mainPath)) throw unsupported('main must be a local HTML file');
  const token = randomBytes(32).toString('hex');
  const prefix = `/${randomBytes(24).toString('hex')}/`;
  let origin;
  const utf8 = value => {
    const encoding = typeof value === 'object' && value !== null ? value.encoding : value;
    if (encoding !== 'utf8' && encoding !== 'utf-8') throw unsupported('This bridge supports UTF-8 text only');
    return 'utf8';
  };
  function call({ module, method, args }) {
    if (!Array.isArray(args) || args.length > 32) throw TypeError('Expected a bounded argument array');
    if (module === 'fs') {
      const file = safePath(args[0]);
      switch (method) {
        case 'readFileSync':
          if (fs.statSync(file).size > 1048576) throw unsupported('Synchronous reads are limited to 1 MiB');
          return fs.readFileSync(file, utf8(args[1]));
        case 'writeFileSync':
          if (typeof args[1] !== 'string') throw unsupported('Only text writes are supported');
          if (args[2] !== undefined && args[2] !== null) utf8(args[2]);
          return fs.writeFileSync(file, args[1], 'utf8');
        case 'existsSync': return fs.existsSync(file);
        case 'readdirSync':
          if (args[1] !== undefined && args[1] !== null) throw unsupported('Directory options are not supported');
          return fs.readdirSync(file);
        case 'mkdirSync':
          if (args[1] && (typeof args[1] !== 'object' || Object.keys(args[1]).some(key => key !== 'recursive')))
            throw unsupported('Only mkdir recursive is supported');
          return fs.mkdirSync(file, { recursive: args[1]?.recursive === true });
        case 'unlinkSync': return fs.unlinkSync(file);
        default: throw unsupported(`Unsupported fs method: ${method}`);
      }
    }
    if (module === 'path') {
      if (!['basename', 'dirname', 'extname', 'isAbsolute', 'join', 'normalize', 'relative', 'resolve', 'parse', 'format'].includes(method))
        throw unsupported(`Unsupported path method: ${method}`);
      return method === 'resolve' ? path.resolve(root, ...args) : path[method](...args);
    }
    if (module === 'os' && ['platform', 'arch', 'type', 'release', 'endianness'].includes(method)) return os[method](...args);
    if (module === 'json' && method === 'require') {
      const file = safePath(path.resolve(path.dirname(mainPath), args[0]));
      if (!file.endsWith('.json') || fs.statSync(file).size > 1048576) throw unsupported('Only small local JSON modules are supported');
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    if (module === 'app' && method === 'quit') return;
    throw unsupported(`Unsupported module or method: ${module}.${method}`);
  }
  const mime = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.cjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'no-store');
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    try {
      if (req.headers.host !== new URL(origin).host) throw denied('Invalid Host');
      const url = new URL(req.url, origin);
      if (!url.pathname.startsWith(prefix)) { res.writeHead(404); res.end(); return; }
      if (url.pathname === `${prefix}__rpc`) {
        if (manifest.nodejs === false) throw denied('Node capabilities are disabled');
        const supplied = req.headers['x-nw-token'];
        if (req.method !== 'POST' || req.headers.origin !== origin || typeof supplied !== 'string' || supplied.length !== token.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token)))
          throw denied('Unauthorized bridge request');
        if (req.headers['content-type'] !== 'application/json') throw denied('Expected JSON');
        let length = 0;
        const chunks = [];
        for await (const chunk of req) { length += chunk.length; if (length > MAX_BODY) throw denied('Request too large'); chunks.push(chunk); }
        const request = JSON.parse(Buffer.concat(chunks).toString());
        const value = call(request);
        if (request.module === 'app' && request.method === 'quit') res.once('finish', () => setImmediate(() => { Promise.resolve().then(onQuit).catch(() => {}); }));
        json(200, { ok: true, value });
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw denied('Read-only resource endpoint');
      let relative = decodeURIComponent(url.pathname.slice(prefix.length));
      if (relative.endsWith('/')) relative += 'index.html';
      const file = safePath(relative);
      if (!fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
      res.setHeader('Content-Type', mime[path.extname(file).toLowerCase()] || 'application/octet-stream');
      if (req.method === 'HEAD') { res.end(); return; }
      const stream = fs.createReadStream(file);
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    } catch (error) {
      if (!res.headersSent) json(error.code === 'EACCES' ? 403 : error.code === 'ENOENT' ? 404 : 400, { ok: false, error: { name: error.name, code: error.code, message: error.message } });
      else res.destroy();
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  const baseURL = `${origin}${prefix}`;
  const entryURL = new URL(manifest.main, baseURL).href;
  if (!entryURL.startsWith(baseURL)) { server.close(); throw denied('Entry escaped application root'); }
  const config = { origin, prefix, token, metadata: { root, dirname: path.dirname(mainPath), platform: process.platform, arch: process.arch, node: process.versions.node, argv, processArgv: [process.execPath, root, ...argv], title: manifest.window?.title, sep: path.sep, delimiter: path.delimiter, eol: os.EOL, nodejs: manifest.nodejs !== false } };
  return { origin, baseURL, entryURL, config, close: () => new Promise(resolve => { server.close(resolve); server.closeIdleConnections?.(); }) };
}
module.exports = { createAppServer };
