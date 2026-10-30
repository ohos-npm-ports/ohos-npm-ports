export const extendedHtml = `<!doctype html><meta charset="utf-8"><h1>Extended smoke</h1>
<input id="file" type="file"><button id="upload">Upload</button><div id="result"></div>
<iframe id="frame" src="/frame"></iframe><button id="alert">Alert</button><button id="confirm">Confirm</button><button id="download">Download response</button><a id="save" href="/download" download="smoke.txt">Save file</a>
<script>
const result=document.querySelector('#result');
document.querySelector('#upload').onclick=async()=>{const form=new FormData();form.append('file',document.querySelector('#file').files[0]);result.textContent=await(await fetch('/upload',{method:'POST',body:form})).text()};
document.querySelector('#alert').onclick=()=>alert('smoke alert');
document.querySelector('#confirm').onclick=()=>result.textContent=confirm('smoke confirm')?'confirmed':'cancelled';
document.querySelector('#download').onclick=async()=>{const r=await fetch('/download');result.textContent=r.headers.get('content-disposition')+'|'+await r.text()};
</script>`;
export const frameHtml = `<input id="inside"><button id="inside-button">Click</button><div id="inside-result"></div><script>document.querySelector('#inside-button').onclick=()=>document.querySelector('#inside-result').textContent=document.querySelector('#inside').value</script>`;
export const screenshotHtml = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;min-height:2400px;background:rgb(230,231,232)}#swatch{position:absolute;top:40px;left:20px;width:120px;height:80px;background:rgb(17,34,51)}#footer{position:absolute;top:2320px;width:100%;height:80px;background:rgb(60,120,180)}</style><div id="swatch"></div><div id="footer"></div>`;
