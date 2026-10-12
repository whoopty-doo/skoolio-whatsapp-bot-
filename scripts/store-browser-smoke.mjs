import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const WebSocket=require('ws');
const {storeAdminResponse}=await import('../store-admin.js');
let items=[],uploads=0,fail=false;
const server=http.createServer(async(req,res)=>{
 if(req.url==='/admin/store'){const page=storeAdminResponse();res.writeHead(page.status,Object.fromEntries(page.headers));res.end(await page.text());return;}
 res.setHeader('Content-Type','application/json');
 if(fail){res.statusCode=503;res.end(JSON.stringify({error:'Synthetic unavailable'}));return;}
 if(req.url.endsWith('/scopes')){res.end(JSON.stringify({items:[{id:'t',name:'Test tenant',centres:[{id:'c',name:'Test Centre'}]}]}));return;}
 if(req.method==='POST'){
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  if(req.url.endsWith('/assets')){uploads++;res.end(JSON.stringify({id:'a'.repeat(64),width:1,height:1}));return;}
  const input=JSON.parse(Buffer.concat(chunks));let item=items.find(p=>p.id===input.id);
  item={...item,id:item?.id??'store_'+'b'.repeat(32),draft:input.draft??item.draft,revision:(item?.revision??0)+1,status:input.action==='publish'?'published':input.action==='archive'?'archived':item?.status??'draft',published:input.action==='publish'?item.draft:item?.published??null};
  items=[item];res.end(JSON.stringify({item}));return;
 }
 if(req.url.includes('/assets/')){res.setHeader('Content-Type','image/png');res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==','base64'));return;}
 res.end(JSON.stringify({items}));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const profile = await mkdtemp(join(tmpdir(), 'skoolio-browser-'));
const browser = spawn(process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let socket;
try {
  const endpoint = await new Promise((resolve, reject) => { let output = ''; const timeout = setTimeout(() => reject(new Error('Chrome did not start')), 15000); browser.stderr.on('data', bytes => { output += bytes; const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } }); browser.on('error', reject); });
  socket = new WebSocket(endpoint); await new Promise(resolve => socket.once('open', resolve));
  let next = 0; const pending = new Map(); const errors = [];
  socket.on('message', raw => { const message = JSON.parse(raw); if (message.id) { const call = pending.get(message.id); pending.delete(message.id); message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result); } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text); });
  const command = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params, sessionId })); });
  const { targetId } = await command('Target.createTarget', { url: 'about:blank' }); const { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => command(method, params, sessionId);
  await send('Runtime.enable'); await send('Page.enable');
  const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
  const waitFor = async expression => { const end = Date.now() + 8000; while (!await evaluate(expression)) { if (Date.now() > end) throw new Error('Browser wait timed out: ' + expression); await new Promise(resolve => setTimeout(resolve, 40)); } };
  await send('Emulation.setDeviceMetricsOverride',{width:1512,height:1100,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/admin/store`});
  await waitFor("document.getElementById('notice').textContent.includes('Catalogue ready')");
  await evaluate(`window.confirm=()=>true;document.getElementById('name').value='Bolt <img src=x onerror=alert(1)>';document.getElementById('description').value='Your Cowlaxy companion';document.getElementById('tenant').value='t';document.getElementById('tenant').dispatchEvent(new Event('change'));document.querySelector('#centres input').checked=true;document.getElementById('name').dispatchEvent(new Event('input',{bubbles:true}));`);
  await evaluate(`const transfer=new DataTransfer();transfer.items.add(new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0))],'bolt.png',{type:'image/png'}));document.getElementById('image').files=transfer.files;document.getElementById('image').dispatchEvent(new Event('change'));`);
  await waitFor("document.getElementById('notice').textContent.includes('Artwork uploaded')");assert.equal(uploads,1);
  await evaluate("document.getElementById('save').click()");await waitFor("document.getElementById('notice').textContent.includes('Draft saved')");assert.equal(items[0].status,'draft');assert.deepEqual(items[0].draft.centreIds,['c']);
  assert.equal(await evaluate("document.querySelector('#products img')===null"),true);
  assert.equal(items[0].draft.collection,'character');
  await evaluate("document.getElementById('publish').click()");await waitFor("document.getElementById('notice').textContent.startsWith('Published.')");assert.equal(items[0].status,'published');
  assert.equal(await evaluate("document.getElementById('image').disabled"),true);
  await writeFile('/private/tmp/playsmart-store-admin-desktop.png',Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await evaluate("document.getElementById('price').value='150';document.getElementById('save').click()");await waitFor("document.getElementById('notice').textContent.includes('Draft saved')");assert.equal(items[0].published.price,100);assert.equal(items[0].draft.price,150);
  await evaluate("document.getElementById('archive').click()");await waitFor("document.getElementById('notice').textContent.includes('Archived.')");assert.equal(items[0].status,'archived');
  fail=true;await evaluate("document.getElementById('reload').click()");await waitFor("document.getElementById('notice').textContent.includes('Synthetic unavailable')");
  fail=false;await evaluate("document.getElementById('reload').click()");await waitFor("document.getElementById('notice').textContent.includes('Catalogue ready')");
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});assert.equal(await evaluate('document.documentElement.scrollWidth<=390'),true);
  await writeFile('/private/tmp/playsmart-store-admin-mobile.png',Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  assert.deepEqual(errors,[]);console.log('PASS Chrome desktop/mobile: upload, scoped draft, publish, edit without live price change, archive, error recovery, XSS escaping, responsive width.');
  for (const category of ['key','planet']) {
    await evaluate(`{document.getElementById('new-product').click();document.getElementById('kind').value='${category}';document.getElementById('name').value='Synthetic ${category}';document.getElementById('description').value='A collectible only';const upload=new DataTransfer();upload.items.add(new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0))],'collectible.png',{type:'image/png'}));document.getElementById('image').files=upload.files;document.getElementById('image').dispatchEvent(new Event('change'));}`);
    await waitFor("document.getElementById('notice').textContent.includes('Artwork uploaded')");
    await evaluate("document.getElementById('save').click()");
    await waitFor("document.getElementById('notice').textContent.includes('Draft saved')");
    assert.equal(items[0].draft.kind,'badge');assert.equal(items[0].draft.collection,category);
    assert.equal(await evaluate("document.getElementById('kind').value"),category);
  }
  console.log('PASS character, key and planet form categories serialize correctly and survive editing.');
} finally {socket?.close();browser.kill();await new Promise(resolve=>server.close(resolve));await new Promise(resolve=>browser.exitCode!==null?resolve():browser.once('exit',resolve));await rm(profile,{recursive:true,force:true});}
