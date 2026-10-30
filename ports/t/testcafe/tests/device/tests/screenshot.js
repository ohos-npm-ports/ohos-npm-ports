import { Selector } from 'testcafe';
fixture('Screenshot capability').page('http://127.0.0.1:14839/extended');
test('TestCafe screenshot API', async t => {
    await t.expect(Selector('h1').innerText).eql('Extended smoke');
    await t.takeScreenshot({ path: 'remote-page.png', fullPage: true });
});
