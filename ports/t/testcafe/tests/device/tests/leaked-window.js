import { Selector } from 'testcafe';
fixture('Context cleanup').page('http://127.0.0.1:14839/');
test('cleanup closes children deliberately left open by test',async t=>{
    await t.openWindow('http://127.0.0.1:14839/next');
    await t.expect(Selector('h1').innerText).eql('Navigation OK');
});
