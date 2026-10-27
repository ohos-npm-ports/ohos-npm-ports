import { Selector } from 'testcafe';
fixture('Window capability').page('http://127.0.0.1:14839/extended');
test('open and close a second window', async t => {
    const original = await t.getCurrentWindow();
    console.log('ROOT_WINDOW',JSON.stringify(original));
    const second = await t.openWindow('http://127.0.0.1:14839/next');
    console.log('CHILD_WINDOW',JSON.stringify(second));
    await t.expect(Selector('h1').innerText).eql('Navigation OK');
    await t.closeWindow(second).switchToWindow(original);
    await t.expect(Selector('h1').innerText).eql('Extended smoke');
});

test('switch between retained windows and restore main page',async t=>{
    const main=await t.getCurrentWindow();
    const second=await t.openWindow('http://127.0.0.1:14839/next');
    await t.expect(Selector('h1').innerText).eql('Navigation OK');
    await t.switchToWindow(main).expect(Selector('h1').innerText).eql('Extended smoke');
    await t.switchToWindow(second).expect(Selector('h1').innerText).eql('Navigation OK');
    await t.closeWindow(second).switchToWindow(main);
});
