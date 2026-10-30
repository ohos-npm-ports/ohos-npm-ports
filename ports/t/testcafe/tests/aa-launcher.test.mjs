import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchHaitai as launch } from './aa-launcher.mjs';
const launchHaitai = options => launch({readState:()=>null,writeState:()=>{},tryProbe:async()=>null,...options});
test('launches via local aa and returns direct TCP endpoint', async () => {
    const calls=[];
    const endpoint = await launchHaitai({port:19222,exec:async(command,args)=>{
        calls.push({command,args}); return {stdout:'start ability successfully',stderr:''};
    },probe:async url=>{assert.equal(url,'http://127.0.0.1:19222/json/version');return {Browser:'Chrome/test','User-Agent':'htbrowser/2.0',webSocketDebuggerUrl:'ws://127.0.0.1:19222/devtools/browser/test'};}});
    assert.equal(endpoint,'http://127.0.0.1:19222');
    assert.equal(calls.length,1);
    assert.equal(calls[0].command,'/usr/bin/aa');
    assert.deepEqual(calls[0].args.slice(0,5),['start','-b','com.haitai.htbrowser','-a','EntryAbility']);
    assert.ok(calls[0].args.includes('--ps'));
    assert.match(calls[0].args.at(-1),/--remote-debugging-port=19222/);
});
test('launch failure does not fall back to hdc', async () => {
    await assert.rejects(launchHaitai({port:19222,exec:async()=>({stdout:'failed',stderr:''}),probe:async()=>{throw Error('must not probe');}}),/aa start failed/);
});
test('rejects endpoint that is not CDP', async () => {
    await assert.rejects(launchHaitai({port:19222,exec:async()=>({stdout:'start ability successfully'}),probe:async()=>({})}),/not a CDP browser/);
});

test('reuse an explicit live Haitai endpoint without calling aa', async () => {
    const endpoint=await launchHaitai({port:19222,tryProbe:async()=>({Browser:'Chrome/test','User-Agent':'htbrowser/2.0',webSocketDebuggerUrl:'ws://127.0.0.1:19222/devtools/browser/test'}),exec:async()=>{throw Error('must not start aa');}});
    assert.equal(endpoint,'http://127.0.0.1:19222');
});
test('reuse cached endpoint only after live identity check', async () => {
    let checked;
    const endpoint=await launchHaitai({readState:()=>({port:19223}),tryProbe:async url=>{checked=url;return {Browser:'Chrome/test','User-Agent':'htbrowser/2.0',webSocketDebuggerUrl:'ws://127.0.0.1:19223/devtools/browser/test'};},exec:async()=>{throw Error('must not start aa');}});
    assert.equal(checked,'http://127.0.0.1:19223/json/version');
    assert.equal(endpoint,'http://127.0.0.1:19223');
});
test('refuse a live endpoint belonging to another browser', async () => {
    await assert.rejects(launchHaitai({port:19222,tryProbe:async()=>({Browser:'Chrome/test','User-Agent':'ArkWeb',webSocketDebuggerUrl:'ws://127.0.0.1:19222/devtools/browser/test'}),exec:async()=>{throw Error('must not start aa');}}),/not Haitai/);
});
test('invalid explicit port is rejected before launch',async()=>{
    await assert.rejects(launchHaitai({port:NaN,exec:async()=>{throw Error('must not start aa');}}),/Invalid CDP port/);
});

test('stale cached endpoint is not trusted and a new endpoint is saved',async()=>{
    let saved;
    const endpoint=await launchHaitai({readState:()=>({port:19223}),tryProbe:async()=>null,exec:async()=>({stdout:'start ability successfully'}),probe:async url=>{const port=new URL(url).port;return {Browser:'Chrome/test','User-Agent':'htbrowser/2.0',webSocketDebuggerUrl:`ws://127.0.0.1:${port}/devtools/browser/test`};},writeState:state=>{saved=state;}});
    assert.equal(endpoint,`http://127.0.0.1:${saved.port}`);
});
test('ENOEXEC wrapper retries via sh without interpreting arguments',async()=>{
    const calls=[];
    await launchHaitai({port:19222,exec:async(command,args)=>{calls.push([command,args]);if(command!=='sh')throw Object.assign(new Error('wrapper'),{code:'ENOEXEC'});return {stdout:'start ability successfully'};},probe:async()=>({Browser:'Chrome/test','User-Agent':'htbrowser/2.0',webSocketDebuggerUrl:'ws://127.0.0.1:19222/devtools/browser/test'})});
    assert.equal(calls.length,2);assert.equal(calls[1][0],'sh');assert.equal(calls[1][1][0],'/usr/bin/aa');
});
