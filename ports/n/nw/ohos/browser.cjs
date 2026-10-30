function installBridge(config) {
  const { metadata } = config;
  if (!metadata.nodejs || location.origin !== config.origin || !location.pathname.startsWith(config.prefix) || window !== window.top) return;
  function unsupported(name) {
    const error = Error(`Unsupported by the local browser bridge: ${name}`);
    error.code = 'ERR_NW_UNSUPPORTED';
    return error;
  }
  function rpc(module, method, args = []) {
    const request = new XMLHttpRequest();
    request.open('POST', `${config.origin}${config.prefix}__rpc`, false);
    request.setRequestHeader('Content-Type', 'application/json');
    request.setRequestHeader('X-NW-Token', config.token);
    request.send(JSON.stringify({ module, method, args }));
    const response = JSON.parse(request.responseText);
    if (request.status !== 200 || !response.ok) {
      const constructors = { Error, TypeError, RangeError, SyntaxError };
      const Constructor = Object.hasOwn(constructors, response.error?.name) ? constructors[response.error.name] : Error;
      const error = new Constructor(response.error?.message || 'Bridge request failed');
      if (response.error?.code) error.code = response.error.code;
      throw error;
    }
    return response.value;
  }
  const module = (name, methods, constants = {}) => Object.freeze(Object.assign({}, constants, Object.fromEntries(methods.map(method => [method, (...args) => rpc(name, method, args)]))));
  const modules = {
    fs: module('fs', ['readFileSync', 'writeFileSync', 'existsSync', 'readdirSync', 'mkdirSync', 'unlinkSync']),
    path: module('path', ['basename', 'dirname', 'extname', 'isAbsolute', 'join', 'normalize', 'relative', 'resolve', 'parse', 'format'], { sep: metadata.sep, delimiter: metadata.delimiter }),
    os: module('os', ['platform', 'arch', 'type', 'release', 'endianness'], { EOL: metadata.eol }),
  };
  const cache = new Map();
  const appWindow = {
    get title() { return document.title; },
    set title(value) { document.title = String(value); },
    on(event, callback) {
      if (event !== 'loaded' || typeof callback !== 'function') throw unsupported(`Window.on(${event})`);
      if (document.readyState === 'complete') queueMicrotask(() => callback.call(appWindow));
      else window.addEventListener('load', () => callback.call(appWindow), { once: true });
      return appWindow;
    },
    reload() { location.reload(); },
    close() { rpc('app', 'quit'); },
  };
  const nw = {
    Window: Object.freeze({ get: (target = window) => { if (target !== window) throw unsupported('Window.get(otherWindow)'); return appWindow; } }),
    App: Object.freeze({ argv: Object.freeze([...metadata.argv]), quit: () => rpc('app', 'quit') }),
    ohos: Object.freeze({ backend: 'haitai', compatibility: 'restricted-bridge' }),
  };
  window.require = name => {
    if (typeof name !== 'string') throw TypeError('Expected module name');
    if (name === 'nw.gui') return nw;
    const builtin = name.replace(/^node:/, '');
    if (Object.hasOwn(modules, builtin)) return modules[builtin];
    if (/^(\.{1,2}\/|\/)/.test(name) && name.endsWith('.json')) {
      const key = rpc('path', 'resolve', [metadata.dirname, name]);
      if (!cache.has(key)) cache.set(key, rpc('json', 'require', [key]));
      return cache.get(key);
    }
    throw unsupported(`require(${name})`);
  };
  window.process = Object.freeze({ platform: metadata.platform, arch: metadata.arch, versions: Object.freeze({ node: metadata.node }), argv: Object.freeze([...(metadata.processArgv || [])]), cwd: () => metadata.root });
  window.__dirname = metadata.dirname;
  nw.require = window.require;
  nw.process = window.process;
  window.nw = Object.freeze(nw);
  if (metadata.title) document.title = metadata.title;
}
module.exports = { installBridge };
