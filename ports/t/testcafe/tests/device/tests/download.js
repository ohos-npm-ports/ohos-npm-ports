import fs from 'fs';import path from 'path';
fixture('Real file download').page('http://127.0.0.1:14839/extended');
test('attachment is saved to disk with expected content',async t=>{
    const file=path.join(process.env.TESTCAFE_DOWNLOAD_DIR,'smoke.txt');
    fs.rmSync(file,{force:true});
    await t.click('#save');
    const deadline=Date.now()+10000;
    while(!fs.existsSync(file)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,100));
    await t.expect(fs.existsSync(file)).ok('download file did not appear');
    await t.expect(fs.readFileSync(file,'utf8')).eql('download-payload');
});
