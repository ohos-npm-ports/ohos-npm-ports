const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const root=process.env.TESTCAFE_PACKAGE;
const code=fs.readFileSync(path.join(root,'lib/browser/provider/built-in/index.js'),'utf8');
for(const platform of ['linux','darwin','win32','openharmony']){
    const original={},ohos={};let loadedOhos=false;
    const sandbox={exports:{},module:{exports:{}},process:{platform},require(name){if(name.includes('/ohos/')){loadedOhos=true;return {createProvider:()=>ohos};}return {__esModule:true,default:name==='./dedicated/chrome'?original:{}};}};
    vm.runInNewContext(code,sandbox);
    assert.equal(sandbox.module.exports.chrome,platform==='openharmony'?ohos:original);
    assert.equal(loadedOhos,platform==='openharmony');
}
console.log('All platform provider branches verified');
