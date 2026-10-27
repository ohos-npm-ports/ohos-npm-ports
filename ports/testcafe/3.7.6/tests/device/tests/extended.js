import { Selector, ClientFunction } from 'testcafe';
fixture('Extended ArkWeb remote').page('http://127.0.0.1:14839/extended');
test('file upload content reaches server', async t => {
    await t.setFilesToUpload('#file', './fixtures/upload.txt').click('#upload');
    await t.expect(Selector('#result').innerText).eql('upload-ok:鸿蒙 upload payload');
});
test('iframe interaction', async t => {
    await t.switchToIframe('#frame').typeText('#inside', 'iframe input').click('#inside-button');
    await t.expect(Selector('#inside-result').innerText).eql('iframe input');
    await t.switchToMainWindow().expect(Selector('h1').innerText).eql('Extended smoke');
});
test('native alert and confirm handlers', async t => {
    await t.setNativeDialogHandler(type => type === 'confirm');
    await t.click('#alert').click('#confirm');
    await t.expect(Selector('#result').innerText).eql('confirmed');
    const history = await t.getNativeDialogHistory();
    await t.expect(history.map(x => x.type)).eql(['confirm', 'alert']);
});
test('cookies and localStorage survive reload', async t => {
    await t.setCookies({ 'smoke-cookie': 'ohos' }, 'http://127.0.0.1:14839/');
    console.log('COOKIE_API', JSON.stringify(await t.getCookies()));
    await ClientFunction(() => localStorage.setItem('smoke-key', 'persisted'))();
    await t.navigateTo('http://127.0.0.1:14839/extended');
    await t.expect(ClientFunction(() => localStorage.getItem('smoke-key'))()).eql('persisted');
    await t.expect(ClientFunction(() => document.cookie)()).contains('smoke-cookie=ohos');
    await t.deleteCookies('smoke-cookie');
    await ClientFunction(() => localStorage.removeItem('smoke-key'))();
});
test('download endpoint response (not disk save)', async t => {
    await t.click('#download');
    await t.expect(Selector('#result').innerText).eql('attachment; filename="smoke.txt"|download-payload');
});
