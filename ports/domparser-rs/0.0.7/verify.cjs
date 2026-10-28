const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const [root,upstream]=process.argv.slice(2).map(p=>path.resolve(p));
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json')));
const original=JSON.parse(fs.readFileSync(path.join(upstream,'package.json')));
assert.equal(pkg.name,'@ohos-npm-ports/domparser-rs');
assert.equal(pkg.version,'0.0.7-1');
assert.deepEqual(pkg.optionalDependencies,original.optionalDependencies);
assert.ok(pkg.files.includes('domparser.openharmony-arm64.node'));
assert.ok(fs.statSync(path.join(root,'domparser.openharmony-arm64.node')).size>0);
for(const file of fs.readdirSync(upstream)) {
 if(file==='package.json')continue;
 assert.deepEqual(fs.readFileSync(path.join(root,file)),fs.readFileSync(path.join(upstream,file)),file);
}
for(const [platform,arch,musl,expected] of [
 ['openharmony','arm64',false,'./domparser.openharmony-arm64.node'],
 ['linux','arm64',false,'domparser-linux-arm64-gnu'],
 ['linux','arm64',true,'domparser-linux-arm64-musl'],
 ['darwin','arm64',false,'domparser-darwin-arm64'],
 ['win32','x64',false,'domparser-win32-x64-msvc'],
]) {
 const native={NodeRepr:class{},parse(){}};
 let selected;
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'index.js'),'utf8'),{
  process:{platform,arch,env:{}},module,exports:module.exports,
  require(id){
   if(id==='fs'||id==='node:fs')return {readFileSync(){return musl?'musl':'glibc';}};
   if(id===expected){selected=id;return native;}
   if(id===`${expected}/package.json`)return {version:'0.0.7'};
   throw new Error(`not installed: ${id}`);
  },
 });
 assert.equal(selected,expected);
 assert.equal(module.exports,native);
}
const expected=structuredClone(original);
expected.name=pkg.name;
expected.version=pkg.version;
expected.repository='https://github.com/ohos-npm-ports/ohos-npm-ports';
expected.files.push('domparser.openharmony-arm64.node');
delete expected.scripts.prepare;
delete expected.scripts.prepublishOnly;
assert.deepEqual(pkg,expected);
console.log('package, native placement, upstream files and platform loaders verified');
