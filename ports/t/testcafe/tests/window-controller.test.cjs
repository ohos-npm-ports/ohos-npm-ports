const {test}=require('node:test');const assert=require('node:assert/strict');
const {createWindowController}=require(require('node:path').join(process.env.TESTCAFE_PACKAGE,'lib/ohos/window-controller.cjs'));
function setup({ignore=false}={}){
    let bounds={left:10,top:20,width:1000,height:800,windowState:'normal'};
    const calls=[];
    const browser={Browser:{getWindowForTarget:async()=>({windowId:7,bounds:{...bounds}}),getWindowBounds:async()=>({bounds:{...bounds}}),setWindowBounds:async({bounds:change})=>{calls.push(change);if(!ignore)bounds={...bounds,...change};}}};
    const readViewport=async()=>({width:bounds.width,height:bounds.height-80,availWidth:1600,availHeight:1000});
    return {controller:createWindowController({browser,target:'tab',readViewport,pause:async()=>{}}),calls,getBounds:()=>bounds};
}
test('real window resize compensates browser chrome and restores initial bounds',async()=>{
    const {controller,calls,getBounds}=setup();await controller.resize(800,600);
    assert.equal(getBounds().width,800);assert.equal(getBounds().height,680);
    await controller.restore();assert.deepEqual(getBounds(),{left:10,top:20,width:1000,height:800,windowState:'normal'});
    assert.ok(calls.every(c=>!('deviceScaleFactor' in c)));
});
test('rejects unsupported dimensions without changing window',async()=>{
    const {controller,calls}=setup();assert.equal(await controller.canResize(800,600),true);assert.equal(await controller.canResize(2000,600),false);
    await assert.rejects(controller.resize(-1,600),/Invalid/);assert.equal(calls.length,0);
});
test('maximize checks actual resulting window state and restores',async()=>{
    const {controller,getBounds}=setup();await controller.maximize();assert.equal(getBounds().windowState,'maximized');await controller.restore();assert.equal(getBounds().windowState,'normal');
});
test('a successful CDP response without a real resize is an error',async()=>{
    const {controller}=setup({ignore:true});await assert.rejects(controller.resize(800,600),/did not reach/);await assert.rejects(controller.maximize(),/not maximized/);
});
