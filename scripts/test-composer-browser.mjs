// M6 real existing Learning Studio composer, synthetic workspace only.
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
const workspace=await createLocalLearningWorkspace(undefined,true,true);
const output=resolve(process.argv[2]);let saved,composerVisible=true;const calls=[],drafts=[];
const {mockFactoryImage}=require('./src/services/learningFactoryMockProviders.ts');
const server=createServer(async(req,res)=>{
 try{
  calls.push(req.method+' '+req.url);let result;
  if(req.url==='/admin/learning-factory'||req.url==='/admin/game-studio?learning=1'){
   const html=req.url.includes('?')?universalStudioResponse({embedded:true}):learningStudioResponse();res.writeHead(200,Object.fromEntries(html.headers));res.end(await html.text());return;
  }
  if(req.method==='GET'&&['/api/admin/game-studio/games','/api/admin/game-studio/banks','/api/admin/game-studio/compositions','/api/admin/store/scopes'].includes(req.url))result={items:[]};
  else if(req.url==='/api/admin/game-studio/learning/catalogue'){result=await workspace.catalogue(actor);if(!composerVisible)delete result.composer;}
  else if(req.method==='POST'){
   let raw='';for await(const b of req)raw+=b;const body=JSON.parse(raw);
   if(req.url==='/api/admin/game-studio/learning/objects'){
    assert.ok(['save','validate'].includes(body.action),'No publication/review allowed in this browser proof');saved=await workspace.act(actor,body);result={item:saved};
   }else if(req.url==='/api/admin/game-studio/learning/compose'){const response=await workspace.compose(actor,body);saved=response.item;result=response;}else if(req.url==='/api/admin/game-studio/learning/engine-tools')result=workspace.engineTool(actor,body);
  }
  if(!result){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
 }catch(e){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
const profile=await mkdtemp(join(tmpdir(),'m6-composer-browser-'));
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
 const set=(id,value)=>evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});if(!e)throw Error('Missing '+${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input'));e.dispatchEvent(new Event('change'));})()`);
 const click=id=>evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
 const go=n=>evaluate(`document.querySelectorAll('#steps button')[${n}].click()`);
 await send('Page.navigate',{url:base+'/admin/learning-factory'});
 await wait("document.getElementById('notice').textContent.includes('ready for isolated')");
 for(const kind of ['game','mission','skillPack']){
  await evaluate("document.querySelector('[data-view=klik]').click()");
  await wait("document.getElementById('compose-new-"+kind+"')!==null");
  await click('compose-new-'+kind);
  if(kind==='game')await wait("document.getElementById('game-editor-frame')?.dataset.ready==='true'");
  await set('object-title','M6 browser '+kind);
  await set('composer-brief','Assemble an editable space learning draft');
  await set('composer-levels',2);await set('composer-stages',2);
  await set('composer-asset-brief','A reviewed Cowlaxy cover request');
  await click('composer-create');
  await wait("document.getElementById('notice').textContent.includes('Composition validated')");
  assert.equal(saved.status,'DRAFT');assert.equal(saved.publishedRevision,0);
  assert.equal(saved.composer.assetRequests.length,1);
  if(kind==='game')assert.equal(saved.body.definition.levels.length,2);
  if(kind==='mission')assert.equal(saved.body.definition.stages.length,2);
  if(kind==='skillPack')assert.equal(saved.body.definition.v2.pack.weeks.length,1);
  const protectedSection=kind==='game'?'game':kind==='mission'?'stages':'activities';
  const original=JSON.stringify(saved.body.definition);
  await click('section-protect-'+protectedSection);
  await wait("document.getElementById('notice').textContent.includes('Section "+protectedSection+" updated')");
  await set('section-brief-details','Improve the draft description only');
  await click('section-regenerate-details');
  await wait("document.getElementById('notice').textContent.includes('Section details updated')");
  assert.equal(JSON.stringify(saved.body.definition),original);
  assert.ok(saved.composer.protectedSections.includes(protectedSection));
  await set('section-json-details',JSON.stringify(kind==='skillPack'?{title:'Edited Week 1',description:'Manual review description','definition.subtitle':saved.body.definition.subtitle,'definition.targetGuidance':saved.body.definition.targetGuidance}:{title:'Edited '+kind,description:'Manual review description'}));
  await click('section-save-details');
  await wait("document.getElementById('notice').textContent.includes('Section details updated') && document.getElementById('object-title').value.startsWith('Edited')");
  assert.equal(saved.body.description,'Manual review description');
  const preview=await workspace.preview(actor,saved.id);
  assert.equal(preview.productionAuthorized,false);
  drafts.push({kind,row:saved,preview});
  // Opening a prepared asset request only prefills the existing library workflow.
  await click('composer-asset-0');
  await wait("document.getElementById('generate-brief')!==null");
  assert.equal(await evaluate("document.getElementById('generate-brief').value"),'A reviewed Cowlaxy cover request');
 }
 assert.ok(!calls.some(c=>c.includes('/generate')));
 composerVisible=false;
 await evaluate("document.querySelector('[data-view=drafts]').click()");
 await wait("document.getElementById('open-"+drafts[2].row.id+"')!==null");
 await click('open-'+drafts[2].row.id);
 await wait("document.getElementById('object-title')!==null");
 assert.equal(await evaluate("document.getElementById('section-activities')"),null);
 assert.equal(await evaluate("document.getElementById('notice').classList.contains('error')"),false);

 const fixtures=[];
 // Test-only explicit review transitions prepare exact browser drafts for the
 // unchanged offline exporter. The browser never publishes or approves.
 for(const draft of drafts){
  let row=draft.row;
  for(const action of ['validate','review','previewed','approve','publish'])row=await workspace.act(actor,{id:row.id,expectedVersion:row.editVersion,action,...action==='previewed'?{previewDigest:draft.preview.digest}:{},...action==='approve'?{reviewed:true,note:'Synthetic native fixture review only; no live or educational approval'}:{}});
  const a=await workspace.contentPack(actor,row.id,1,async()=>Buffer.from(mockFactoryImage('M6 browser fixture art').png,'base64'));
  fixtures.push({kind:draft.kind,engine:draft.kind==='skillPack'?'learning-v2':draft.kind==='mission'?'mission':row.body.definition.engine,family:draft.kind==='skillPack'?'BUILD/SELECT/STORY/RESPOND':'MOVE',manifest:a.manifest,digest:a.digest,objects:Object.fromEntries([...a.objects].map(([h,b])=>[h,b.toString('base64')]))});
 }
 await writeFile(output,JSON.stringify({version:1,provider:'mock:klik-composer',productionAuthorized:false,drafts,fixtures})+'\n');
 await writeFile(output+'.evidence.json',JSON.stringify({passed:true,calls,compositions:drafts.map(d=>({kind:d.kind,id:d.row.id,editVersion:d.row.editVersion,previewDigest:d.preview.digest})),provider:'mock',livePublication:false,nativeAcceptanceRequired:true},null,2));
 console.log('PASS: existing Studio composed Game/Mission/Week1, protected sections survived regeneration, manual editing persisted, Nano Banana request opened without generation. Exact native fixtures exported.');

} finally {
 socket?.close();const exited=new Promise(r=>browser.once('exit',r));browser.kill();await exited;
 server.close();await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
