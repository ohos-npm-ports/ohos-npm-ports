import { Selector, ClientFunction } from 'testcafe';
import fs from 'fs';import path from 'path';import { PNG } from 'pngjs';
fixture('Child window screenshot routing').page('http://127.0.0.1:14839/extended');
test('child screenshot and resize target the child, not its parent',async t=>{
    const main=await t.getCurrentWindow();
    const child=await t.openWindow('http://127.0.0.1:14839/shots');
    await t.resizeWindow(800,600);
    await t.expect(ClientFunction(()=>innerWidth)()).eql(800);
    await t.takeElementScreenshot('#swatch','child-element.png');
    const image=PNG.sync.read(fs.readFileSync(path.join(__dirname,'../logs/provider-screenshots/child-element.png')));
    const dpr=await ClientFunction(()=>devicePixelRatio)();
    await t.expect(image.width).eql(120*dpr).expect(image.height).eql(80*dpr);
    await t.expect([...image.data.slice(0,3)]).eql([17,34,51]);
    await t.closeWindow(child).switchToWindow(main);
    await t.expect(Selector('h1').innerText).eql('Extended smoke');
});
