const {test}=require('node:test');const assert=require('node:assert/strict');const log=require(require('node:path').join(process.env.TESTCAFE_PACKAGE,'lib/ohos/log.cjs'));
test('adapter diagnostics never contaminate reporter stdout',()=>{
 const before=process.env.TESTCAFE_OHOS_DEBUG,original=console.error;const entries=[];
 try{console.error=(...args)=>entries.push(args);delete process.env.TESTCAFE_OHOS_DEBUG;log('silent');assert.equal(entries.length,0);process.env.TESTCAFE_OHOS_DEBUG='1';log('debug');assert.deepEqual(entries,[['debug']]);}finally{console.error=original;if(before===undefined)delete process.env.TESTCAFE_OHOS_DEBUG;else process.env.TESTCAFE_OHOS_DEBUG=before;}
});
