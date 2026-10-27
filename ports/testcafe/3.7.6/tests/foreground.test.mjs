import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureForeground } from './foreground.mjs';
test('waits for a visible focused target instead of trusting bringToFront',async()=>{
    let activations=0;
    const client={Page:{bringToFront:async()=>{activations++;}},Runtime:{evaluate:async()=>({result:{value:{visibility:activations>1?'visible':'hidden',focus:activations>1}}})}};
    await ensureForeground(client,{timeoutMs:1000,intervalMs:1});
    assert.equal(activations,2);
});
test('background target is an explicit failure',async()=>{
    const client={Page:{bringToFront:async()=>{}},Runtime:{evaluate:async()=>({result:{value:{visibility:'hidden',focus:false}}})}};
    await assert.rejects(ensureForeground(client,{timeoutMs:5,intervalMs:1}),/not foreground/);
});
test('guard reactivates a target hidden after navigation and stops cleanly',async()=>{
    const { keepForeground }=await import('./foreground.mjs');
    let foreground=false,activations=0,reads=0;
    const client={Page:{bringToFront:async()=>{foreground=true;activations++;}},Runtime:{evaluate:async()=>{reads++;return {result:{value:{visibility:foreground?'visible':'hidden',focus:foreground}}};}}};
    const stop=keepForeground(client,{intervalMs:1});
    await new Promise(resolve=>setTimeout(resolve,20));
    assert.ok(activations>=1);
    await stop(); const before=reads;
    await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(reads,before);
});
