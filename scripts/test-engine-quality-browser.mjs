// M5 real Learning Studio + embedded Universal editor, synthetic workspace only.
// Run from an isolated backend checkout with its network-blocking test preload
// and ts-node/register. No authentication, publication, database or cloud calls.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import WebSocket from 'ws';
import {universalStudioResponse} from '../universal-studio.js';
import {learningStudioResponse} from '../learning-studio.js';
const require=createRequire(join(process.cwd(),'package.json'));
const {createLocalLearningWorkspace,syntheticAuthor:actor}=require('./tools/testing/learningFactoryWorkspace.ts');
const workspace=await createLocalLearningWorkspace(undefined,true);
const output=resolve(process.argv[2]);let saved;const calls=[];
const server=createServer(async(req,res)=>{
 try{
  calls.push(req.method+' '+req.url);let result;
  if(req.url==='/admin/learning-factory'||req.url==='/admin/game-studio?learning=1'){
   const html=req.url.includes('?')?universalStudioResponse({embedded:true}):learningStudioResponse();res.writeHead(200,Object.fromEntries(html.headers));res.end(await html.text());return;
  }
  if(req.method==='GET'&&['/api/admin/game-studio/games','/api/admin/game-studio/banks','/api/admin/game-studio/compositions','/api/admin/store/scopes'].includes(req.url))result={items:[]};
  else if(req.url==='/api/admin/game-studio/learning/catalogue')result=await workspace.catalogue(actor);
  else if(req.method==='POST'){
   let raw='';for await(const b of req)raw+=b;const body=JSON.parse(raw);
   if(req.url==='/api/admin/game-studio/learning/objects'){
    assert.ok(['save','validate'].includes(body.action),'No publication/review allowed in this browser proof');saved=await workspace.act(actor,body);result={item:saved};
   }else if(req.url==='/api/admin/game-studio/learning/engine-tools')result=workspace.engineTool(actor,body);
  }
  if(!result){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
 }catch(e){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
const profile=await mkdtemp(join(tmpdir(),'m5-factory-browser-'));
const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
let socket;
try {
 const endpoint=await new Promise((resolve,reject)=>{let out='';const timeout=setTimeout(()=>reject(Error('Chrome timeout')),15000);browser.stderr.on('data',b=>{out+=b;const m=out.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timeout);resolve(m[1]);}});browser.on('error',reject);});
 socket=new WebSocket(endpoint);await new Promise(r=>socket.once('open',r));let next=0;const pending=new Map();
 socket.on('message',b=>{const m=JSON.parse(b);if(m.id){const c=pending.get(m.id);pending.delete(m.id);m.error?c.reject(Error(m.error.message)):c.resolve(m.result);}});
 const command=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,sessionId}));});
 const {targetId}=await command('Target.createTarget',{url:'about:blank'}),{sessionId}=await command('Target.attachToTarget',{targetId,flatten:true});
 const send=(m,p)=>command(m,p,sessionId);
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const wait=async expression=>{const end=Date.now()+15000;while(!await evaluate(expression)){if(Date.now()>end)throw Error('Timed out: '+expression);await new Promise(r=>setTimeout(r,50));}};
 const set=(id,value)=>evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});if(!e)throw Error('Missing '+${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change'));})()`);
 const click=id=>evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
 const go=n=>evaluate(`document.querySelectorAll('#steps button')[${n}].click()`);
 await send('Page.navigate',{url:base+'/admin/learning-factory'});
 await wait("document.getElementById('notice').textContent.includes('ready for isolated')");
 await click('create-game');await wait("document.getElementById('game-editor-frame')?.dataset.ready==='true'");
 const inner=expression=>evaluate(`(()=>{const document=window.document.getElementById('game-editor-frame').contentDocument;return (${expression});})()`);
 await inner("document.querySelectorAll('#steps button')[4].click()");
 assert.match(await inner("document.querySelector('#native-capabilities legend').textContent"),/Native controls/);
 await inner("(()=>{const e=document.getElementById('cap-settings-speed');e.value='195';e.dispatchEvent(new Event('change'));return e.value;})()");
 await inner("(()=>{const e=document.getElementById('cap-settings-speed');e.value='999';e.dispatchEvent(new Event('change'));return e.value;})()");
 assert.equal(await inner("document.getElementById('cap-settings-speed').value"),'195');
 assert.equal(await inner("document.getElementById('cap-settings-gravity')"),null);
 await click('save-draft');await wait("document.getElementById('notice').textContent.includes('Draft saved')");
 assert.equal(saved.body.definition.levels[0].config.settings.speed,195);assert.equal(saved.status,'DRAFT');
 await click('validate');await wait("document.getElementById('notice').textContent.includes('Recorded validate')");
 assert.ok(saved.validation);const preview=await workspace.preview(actor,saved.id);
 assert.equal(preview.game.levels[0].config.settings.speed,195);assert.equal(preview.productionAuthorized,false);
 await click('create-pack');await click('tab-weeks');await wait("document.querySelector('select[id^=engine-]')!==null");
 assert.deepEqual(await evaluate("Array.from(document.querySelector('select[id^=engine-]').options).map(o=>o.value).sort()"),['BUILD','RESPOND','SELECT','STORY']);
 await writeFile(output,JSON.stringify(preview,null,2));
 await writeFile(output+'.evidence.json',JSON.stringify({passed:true,calls,draft:saved.body.definition,editVersion:saved.editVersion,registryVersion:1,previewDigest:preview.digest,published:false},null,2));
 console.log('PASS: actual parent/iframe registry controls reject unsupported/out-of-range values; existing versioned draft save/validate emits native preview. No live publication.');

} finally {
 socket?.close();const exited=new Promise(r=>browser.once('exit',r));browser.kill();await exited;
 server.close();await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
