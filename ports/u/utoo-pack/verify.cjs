const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const [root, upstream] = process.argv.slice(2).map(p => path.resolve(p));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
const original = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json')));
assert.equal(pkg.name, '@ohos-npm-ports/utoo-pack');
assert.equal(pkg.version, original.version);
assert.equal(pkg.dependencies['domparser-rs'], 'npm:@ohos-npm-ports/domparser-rs@0.0.7-1');
assert.deepEqual(pkg.optionalDependencies, original.optionalDependencies);
assert.equal(pkg.dependencies['@utoo/pack-shared'], '1.5.31');
assert.ok(fs.statSync(path.join(root, 'cjs/pack.openharmony-arm64.node')).size > 0);
for (const dir of ['cjs', 'esm']) {
 const code=fs.readFileSync(path.join(root,dir,'binding.js'),'utf8');
 for (const [platform,arch,musl,expected] of [
  ['openharmony','arm64',false,dir==='cjs'?'./pack.openharmony-arm64.node':'../cjs/pack.openharmony-arm64.node'],
  ['linux','arm64',false,'@utoo/pack-linux-arm64-gnu'],
  ['linux','arm64',true,'@utoo/pack-linux-arm64-musl'],
  ['darwin','arm64',false,'@utoo/pack-darwin-arm64'],
  ['win32','x64',false,'@utoo/pack-win32-x64-msvc'],
 ]) {
  let selected;
  const native={projectNew(){}};
  const module={exports:{}};
  vm.runInNewContext(code,{
   process:{platform,arch,env:{NAPI_RS_ENFORCE_VERSION_CHECK:'1'}},module,exports:module.exports,
   require(id){
    if(id==='fs')return {readFileSync(){return musl?'musl':'glibc';}};
    if(id===expected){selected=id;return native;}
    if(id===`${expected}/package.json`)return {version:'1.5.31'};
    throw new Error(`not installed: ${id}`);
   },
  });
  assert.equal(selected,expected,`${dir}: ${platform}/${arch}/${musl}`);
  assert.equal(module.exports,native);
 }
}
for(const name of fs.readdirSync(upstream,{recursive:true})) {
 const old=path.join(upstream,name), current=path.join(root,name);
 if(!fs.statSync(old).isFile() || name==='package.json')continue;
 const expected=name==='esm/binding.js'
  ? Buffer.from(fs.readFileSync(old,'utf8').replace("require('./pack.openharmony-arm64.node')","require('../cjs/pack.openharmony-arm64.node')"))
  : fs.readFileSync(old);
 assert.deepEqual(fs.readFileSync(current),expected,name);
}
const expected=structuredClone(original);
expected.name=pkg.name;
expected.version=pkg.version;
expected.repository={...original.repository,url:'https://github.com/ohos-npm-ports/ohos-npm-ports',directory:'ports/utoo-pack/1.5.31'};
expected.dependencies['domparser-rs']='npm:@ohos-npm-ports/domparser-rs@0.0.7-1';
delete expected.scripts.prepublishOnly;
assert.deepEqual(pkg,expected);
console.log('package, native placement, upstream files and platform loaders verified');
