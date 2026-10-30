import { Selector } from 'testcafe';
const value: string = 'TypeScript 鸿蒙';
fixture('TypeScript compiler').page('http://127.0.0.1:14839/');
test('typed test compiles and drives the browser', async t => {
    await t.typeText('#name', value).click('#submit');
    await t.expect(Selector('#result').innerText).eql(`Hello ${value}`);
});
