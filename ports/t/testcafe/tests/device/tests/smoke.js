import { Selector } from 'testcafe';
fixture('ArkWeb remote smoke').page('http://127.0.0.1:14839/');
test('page loads and scripts execute', async t => {
    await t.expect(Selector('h1').innerText).eql('TestCafe OHOS smoke');
    await t.expect(Selector('#boot').innerText).eql('ready');
});
test('type, click and DOM assertion', async t => {
    await t.typeText('#name', '鸿蒙 TestCafe').click('#submit');
    await t.expect(Selector('#result').innerText).eql('Hello 鸿蒙 TestCafe');
});
test('async fetch and navigation', async t => {
    await t.click('#fetch');
    await t.expect(Selector('#result').innerText).eql('server-response');
    await t.click('#next');
    await t.expect(Selector('h1').innerText).eql('Navigation OK');
});
