import { Selector } from 'testcafe';
fixture('Negative control').page('http://127.0.0.1:14839/');
test('deliberately wrong assertion must fail', async t => {
    await t.expect(Selector('h1').innerText).eql('INTENTIONALLY WRONG', { timeout: 1000 });
});
