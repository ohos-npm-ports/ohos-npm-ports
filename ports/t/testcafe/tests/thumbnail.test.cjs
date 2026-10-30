const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');const {PNG}=require('pngjs');
const {generateThumbnail}=require(require('node:path').join(process.env.TESTCAFE_PACKAGE,'lib/ohos/thumbnail.cjs'));
test('thumbnail fits bounds, preserves aspect and pixel colors without native tools',async()=>{
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tc-thumb-'));
    try{const input=new PNG({width:400,height:100});for(let n=0;n<input.data.length;n+=4)input.data.set([17,34,51,255],n);const source=path.join(dir,'source.png'),output=path.join(dir,'thumbnails','source.png');await fs.writeFile(source,PNG.sync.write(input));await generateThumbnail(source,output);const result=PNG.sync.read(await fs.readFile(output));assert.equal(result.width,240);assert.equal(result.height,60);assert.deepEqual([...result.data.slice(0,4)],[17,34,51,255]);}finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('thumbnail rejects malformed input and invalid size',async()=>{
    await assert.rejects(generateThumbnail('missing','unused',0,130),/Invalid/);
});
