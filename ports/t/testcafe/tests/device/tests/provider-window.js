import { ClientFunction } from 'testcafe';
const viewport=ClientFunction(()=>({width:innerWidth,height:innerHeight,outerWidth,outerHeight,availWidth:screen.availWidth,availHeight:screen.availHeight}));
fixture('Haitai real window control').page('http://127.0.0.1:14839/');
test('resize real client area to two exact dimensions',async t=>{
    await t.resizeWindow(800,600);
    let size=await viewport();console.log('WINDOW_800',JSON.stringify(size));
    await t.expect(size.width).eql(800).expect(size.height).eql(600);
    await t.resizeWindow(1024,650);
    size=await viewport();console.log('WINDOW_1024',JSON.stringify(size));
    await t.expect(size.width).eql(1024).expect(size.height).eql(650);
});
test('maximize then return to normal client area',async t=>{
    await t.maximizeWindow();
    const size=await viewport();console.log('WINDOW_MAX',JSON.stringify(size));
    await t.expect(size.width).gte(1024).expect(size.height).gte(650);
    await t.resizeWindow(800,600);
    const normal=await viewport();
    await t.expect(normal.width).eql(800).expect(normal.height).eql(600);
});
