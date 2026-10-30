import { ClientFunction } from 'testcafe';
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
const directory=path.join(__dirname,'../logs/provider-screenshots');
function read(name){return PNG.sync.read(fs.readFileSync(path.join(directory,name)));}
function thumbnail(name){
    if(process.env.TESTCAFE_CHECK_THUMBNAILS!=='1')return;
    const source=read(name),image=PNG.sync.read(fs.readFileSync(path.join(directory,'thumbnails',name)));
    if(image.width>240||image.height>130||image.width<1||image.height<1)throw new Error('Invalid thumbnail dimensions');
    const expected=Math.min(240/source.width,130/source.height);
    if(image.width!==Math.round(source.width*expected)||image.height!==Math.round(source.height*expected))throw new Error('Thumbnail aspect mismatch');
}

fixture('Haitai provider screenshot').page('http://127.0.0.1:14839/shots');
test('viewport PNG has real viewport dimensions',async t=>{
    const geometry=await ClientFunction(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio}))();
    console.log('SCREENSHOT_GEOMETRY',JSON.stringify(geometry));
    await t.takeScreenshot({path:'viewport.png',fullPage:false});
    const image=read('viewport.png');thumbnail('viewport.png');
    await t.expect(image.width).eql(Math.round(geometry.width*geometry.dpr));
    await t.expect(image.height).eql(Math.round(geometry.height*geometry.dpr));
});
test('full-page PNG includes below-fold footer',async t=>{
    const dpr=await ClientFunction(()=>devicePixelRatio)();
    await t.takeScreenshot({path:'full-page.png',fullPage:true});
    const image=read('full-page.png');thumbnail('full-page.png');
    await t.expect(image.height).eql(Math.round(2400*dpr));
    const offset=((image.height-10)*image.width+Math.floor(image.width/2))*4;
    await t.expect([...image.data.slice(offset,offset+3)]).eql([60,120,180]);
});
test('element screenshot has exact size and pixel content',async t=>{
    const dpr=await ClientFunction(()=>devicePixelRatio)();
    await t.takeElementScreenshot('#swatch','element.png');
    const image=read('element.png');thumbnail('element.png');
    await t.expect(image.width).eql(Math.round(120*dpr));
    await t.expect(image.height).eql(Math.round(80*dpr));
    const offset=(Math.floor(image.height/2)*image.width+Math.floor(image.width/2))*4;
    await t.expect([...image.data.slice(offset,offset+3)]).eql([17,34,51]);
});
