import http from 'node:http';
import { existsSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extendedHtml, frameHtml, screenshotHtml } from './extended-page.mjs';
import { createRequire } from 'node:module';
import { once } from 'node:events';
const require = createRequire(import.meta.url);
process.env.TESTCAFE_OHOS_DEBUG ??= '1';
const createTestCafe = require('testcafe');
const html = `<!doctype html><meta charset="utf-8"><h1>TestCafe OHOS smoke</h1>
<div id="boot"></div><input id="name"><button id="submit">Submit</button>
<button id="fetch">Fetch</button><div id="result"></div><a id="next" href="/next">Next</a>
<script>document.querySelector('#boot').textContent='ready';
document.querySelector('#submit').onclick=()=>document.querySelector('#result').textContent='Hello '+document.querySelector('#name').value;
document.querySelector('#fetch').onclick=async()=>document.querySelector('#result').textContent=await(await fetch('/api')).text();</script>`;
const server = http.createServer((req,res)=>{
    console.log('HTTP', req.url);
    if(req.url==='/upload') {
        const chunks=[];
        req.on('data', chunk=>chunks.push(chunk));
        req.on('end',()=>{
            const body=Buffer.concat(chunks).toString('utf8');
            const valid=req.method==='POST' && /multipart\/form-data/.test(req.headers['content-type']||'') && body.includes('filename="upload.txt"') && body.includes('鸿蒙 upload payload');
            res.setHeader('Content-Type','text/plain; charset=utf-8');
            res.end(valid?'upload-ok:鸿蒙 upload payload':'upload-invalid');
        });
        return;
    }
    if(req.url==='/download') {
        res.setHeader('Content-Type','text/plain');
        res.setHeader('Content-Disposition','attachment; filename="smoke.txt"');
        res.end('download-payload'); return;
    }
    if(req.url==='/shots'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(screenshotHtml);return;}
    if(req.url==='/extended' || req.url==='/frame') {
        res.setHeader('Content-Type','text/html; charset=utf-8');
        res.end(req.url==='/extended'?extendedHtml:frameHtml); return;
    }
    res.setHeader('Content-Type',req.url==='/api'?'text/plain; charset=utf-8':'text/html; charset=utf-8');
    res.end(req.url==='/api'?'server-response':req.url==='/next'?'<h1>Navigation OK</h1>':html);
});
let tc;
let finalExitCode = 1;
const watchdog = setTimeout(()=>{ console.error('WATCHDOG_TIMEOUT'); process.exit(2); }, 120000);
try {
    server.listen(14839,'127.0.0.1'); await once(server,'listening');
    tc = await createTestCafe('127.0.0.1',14837,14838);
    const usePort=true;
    const screenshotDir=new URL('./logs/provider-screenshots/',import.meta.url).pathname;
    rmSync(screenshotDir,{recursive:true,force:true});
    const connection='chrome';
    const negative = process.argv.includes('--negative') || process.argv.includes('--suite=negative');
    const suite = process.argv.find(arg=>arg.startsWith('--suite='))?.split('=')[1] || (negative?'negative':'smoke');
    if(!['smoke','negative','extended','screenshot','windows','provider-screenshot','provider-window','window-screenshot','leaked-window','download','typescript'].includes(suite)) throw new Error('Unknown suite');
    const failures = await tc.createRunner().src(new URL(`./tests/${suite}.${suite==='typescript'?'ts':'js'}`,import.meta.url).pathname)
        .browsers(connection).reporter('spec').screenshots({path:screenshotDir,takeOnFails:process.argv.includes('--failure-screenshots'),thumbnails:usePort || process.argv.includes('--thumbnails')}).run({...(process.argv.includes('--auto-native')?{}:{disableNativeAutomation:true}),skipJsErrors:false,selectorTimeout:10000,assertionTimeout:10000,browserRequestTimeout:30000});
    const screenshotArtifactExists = suite === 'screenshot' ? existsSync(`${screenshotDir}/remote-page.png`) : suite === 'provider-screenshot' ? existsSync(`${screenshotDir}/full-page.png`) : null;
    if(usePort){
        const images=[];
        function walk(directory){if(!existsSync(directory))return;for(const item of readdirSync(directory,{withFileTypes:true})){const path=`${directory}/${item.name}`;if(item.isDirectory())walk(path);else if(path.endsWith('.png')){const image=require('pngjs').PNG.sync.read(readFileSync(path));images.push({path,width:image.width,height:image.height});}}}
        walk(screenshotDir);
        console.log('PNG_ARTIFACTS',JSON.stringify(images));
        writeFileSync(new URL(`./logs/png-${suite}.json`,import.meta.url),JSON.stringify(images,null,2));
        if(process.argv.includes('--failure-screenshots')&&!images.some(image=>!image.path.includes('/thumbnails/')))throw new Error('Failure screenshot missing');
    }
    console.log('RESULT',JSON.stringify({suite,negative,failures,expectedFailures:negative?1:0,screenshotArtifactExists}));
    finalExitCode = failures === (negative?1:0) && screenshotArtifactExists !== false?0:1;
} catch(e) {console.error(e.stack);finalExitCode=1;}
finally {
    await tc?.close();
    server.close(); clearTimeout(watchdog);
    process.exit(finalExitCode);
}
