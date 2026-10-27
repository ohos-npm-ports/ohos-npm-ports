const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
const {installDownloads}=require(require('node:path').join(process.env.TESTCAFE_PACKAGE,'lib/ohos/download.cjs'));
test('streams the actual attachment response to a safe host filename',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tc-download-'));let paused;const calls=[];
 const client={Fetch:{enable:async()=>{},disable:async()=>{},requestPaused:callback=>{paused=callback;},takeResponseBodyAsStream:async()=>({stream:'body'}),fulfillRequest:async options=>calls.push(['fulfill',options]),continueRequest:async options=>calls.push(['continue',options]),failRequest:async()=>{}},IO:{read:async()=>({data:Buffer.from('download-payload').toString('base64'),base64Encoded:true,eof:true}),close:async()=>{}}};
 try{const stop=await installDownloads(client,dir);paused({requestId:'id',resourceType:'Document',responseStatusCode:200,responseHeaders:[{name:'Content-Disposition',value:'attachment; filename="../smoke.txt"'}]});await stop();assert.equal(await fs.readFile(path.join(dir,'smoke.txt'),'utf8'),'download-payload');assert.equal(calls[0][1].responseCode,204);assert.equal(calls[0][1].body,'');}finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('non-attachment responses continue without body interception',async()=>{
 let paused,continued=false;const client={Fetch:{enable:async()=>{},disable:async()=>{},requestPaused:fn=>{paused=fn;},continueRequest:async()=>{continued=true;}}};const stop=await installDownloads(client,os.tmpdir());paused({requestId:'id',responseStatusCode:200,responseHeaders:[]});await stop();assert.ok(continued);
});
test('fetch attachment responses remain available to application JavaScript',async()=>{
 let paused,continued=false;const client={Fetch:{enable:async()=>{},disable:async()=>{},requestPaused:fn=>{paused=fn;},continueRequest:async()=>{continued=true;},failRequest:async()=>{}}};const stop=await installDownloads(client,os.tmpdir());paused({requestId:'fetch',resourceType:'Fetch',responseStatusCode:200,responseHeaders:[{name:'Content-Disposition',value:'attachment; filename="fetch.txt"'}]});await stop();assert.ok(continued);
});
test('a child tab already disconnected does not fail download cleanup',async()=>{
 let disconnected;
 const client={on:(_,fn)=>{disconnected=fn;},removeListener:()=>{},Fetch:{enable:async()=>{},requestPaused:()=>{},disable:async()=>{throw Error('WebSocket closed');}}};
 const stop=await installDownloads(client,os.tmpdir());disconnected();await stop();
});
