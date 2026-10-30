const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {PNG}=require('pngjs');
const {createProvider}=require(require('node:path').join(process.env.TESTCAFE_PACKAGE,'lib/ohos/provider.cjs'));
function setup(data){
    const calls=[];
    const client={Page:{enable:async()=>{},navigate:async()=>{},getLayoutMetrics:async()=>({cssContentSize:{x:0,y:0,width:100,height:200}}),captureScreenshot:async options=>{calls.push(options);return {data};}},close:async()=>{calls.push('client-close');}};
    const cdp=async()=>client;
    cdp.Version=async()=>({webSocketDebuggerUrl:'ws://127.0.0.1:9222/devtools/browser/test'});
    cdp.Close=async options=>calls.push(['target-close',options.id]);
    const browser={Browser:{setDownloadBehavior:async options=>calls.push(['download-behavior',options])},Target:{createBrowserContext:async()=>({browserContextId:'owned-context'}),createTarget:async()=>({targetId:'owned-tab'}),disposeBrowserContext:async()=>calls.push(['context-dispose','owned-context'])},close:async()=>{}};
    let connected=0;
    const connect=Object.assign(async()=>++connected===1?browser:client,cdp);
    const provider=createProvider({launch:async()=> 'http://127.0.0.1:9222',CDP:connect,downloads:async()=>async()=>{},foreground:async()=>{},keepForeground:()=>async()=>{}});
    provider.waitForConnectionReady=async()=>{};
    return {provider,calls};
}
test('provider captures PNG to TestCafe path and closes only owned target',async()=>{
    const png=new PNG({width:2,height:3});png.data.fill(255);
    const {provider,calls}=setup(PNG.sync.write(png).toString('base64'));
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tc-provider-'));
    try{
        await provider.openBrowser('id','http://localhost/connect','');
        await provider.takeScreenshot('id',path.join(dir,'capture.png'),2,3,true);
        const image=PNG.sync.read(await fs.readFile(path.join(dir,'capture.png')));
        assert.equal(image.width,2);assert.equal(image.height,3);
        assert.equal(calls[0].captureBeyondViewport,true);
        assert.equal(calls[0].clip.height,200);
        await provider.closeBrowser('id');
        assert.ok(calls.some(x=>Array.isArray(x)&&x[0]==='context-dispose'&&x[1]==='owned-context'));
    }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('malformed CDP screenshot throws rather than pretending success',async()=>{
    const {provider}=setup(Buffer.from('not-png').toString('base64'));
    await provider.openBrowser('id','http://localhost/connect','');
    await assert.rejects(provider.takeScreenshot('id','unused.png',2,3,false),/PNG/);
    await provider.closeBrowser('id');
});
test('multi-window state is tracked per TestCafe connection',async()=>{
    const {provider}=setup();provider.calculateWindowId=()=> 'root-window';
    await provider.openBrowser('id','http://localhost/connect','');
    assert.equal(provider.supportMultipleWindows,true);
    assert.equal(provider.getActiveWindowId('id'),'root-window');
    provider.setActiveWindowId('id','child-window');assert.equal(provider.getActiveWindowId('id'),'child-window');
    provider.resetActiveWindowId('id');assert.equal(provider.getActiveWindowId('id'),undefined);
    await provider.closeBrowser('id');
});
test('download configuration is scoped to the owned browser context',async()=>{
    const old=process.env.TESTCAFE_DOWNLOAD_DIR;process.env.TESTCAFE_DOWNLOAD_DIR='/data/storage/el2/base/cache/testcafe-download-unit';
    try{const {provider,calls}=setup();await provider.openBrowser('id','http://localhost/connect','');assert.ok(calls.some(x=>Array.isArray(x)&&x[0]==='download-behavior'&&x[1].browserContextId==='owned-context'));await provider.closeBrowser('id');}finally{if(old===undefined)delete process.env.TESTCAFE_DOWNLOAD_DIR;else process.env.TESTCAFE_DOWNLOAD_DIR=old;}
});
