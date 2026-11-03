// M4 synthetic authoring -> existing backend compiler -> native preview data.
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
const require=createRequire(join(process.cwd(),'package.json'));
const {compileFactoryGame,factoryHash}=require('./src/services/gameFactory.ts');
const output=resolve(process.argv[2]);
let compiled, authored, calls=[];
const server=createServer(async(req,res)=>{
 try {
  calls.push(req.method+' '+req.url);
  if(req.url==='/admin/game-studio') {
   const html=universalStudioResponse();res.writeHead(200,Object.fromEntries(html.headers));res.end(await html.text());return;
  }
  if(req.method==='GET'&&['/api/admin/game-studio/games','/api/admin/game-studio/banks','/api/admin/game-studio/compositions','/api/admin/store/scopes'].includes(req.url)) {
   res.setHeader('Content-Type','application/json');res.end('{"items":[]}');return;
  }
  if(req.method==='POST'&&req.url==='/api/admin/game-studio/preview') {
   let body='';for await(const b of req)body+=b;
   authored=JSON.parse(body);compiled=compileFactoryGame('m4_browser_word_rocket',1,authored);
   const game={schema:1,game:compiled,digest:factoryHash(compiled),audience:authored.audience,publishedAt:new Date(0).toISOString(),creatorCredit:'Synthetic M4 browser proof',capabilities:{education:1,engines:{rocket:compiled.levels[0].version},worlds:{[compiled.levels[0].world.id]:1}}};
   await writeFile(output,JSON.stringify(game,null,2));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({game}));return;
  }
  res.writeHead(404);res.end();
 } catch(e){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
const profile=await mkdtemp(join(tmpdir(),'m4-factory-browser-'));
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
 await send('Page.navigate',{url:base+'/admin/game-studio'});await wait("document.getElementById('notice').textContent.includes('Ready.')");
 await go(3);await set('condition','sequence');await set('spelling-en','MOON');await set('spelling-af','MAAN');await set('distractors','S');await click('derive-sequence');
 await set('spelling-en','ABCDEFGHIJKLM');await click('derive-sequence');
 assert.match(await evaluate("document.getElementById('notice').textContent"),/up to 12/);
 await go(2);await set('world','nebula');await set('fuel-seconds',150);await set('landing-speed',120);
 await go(4);await set('setting-speed',190);await set('setting-hints','no');await set('category','words');await set('skill','spelling');await set('audience','public');
 await go(5);await click('download-preview');await wait("document.getElementById('notice').classList.contains('error') || !document.getElementById('download-preview').disabled");
 if(!compiled)throw Error(await evaluate("document.getElementById('notice').textContent"));
 const c=compiled.levels[0].config;
 assert.ok(c.bank.items.every(i=>i.type==='letter'));
 assert.deepEqual(c.rules[0].values,{en:['M','O','O','N'],af:['M','A','A','N']});
 assert.equal(c.settings.speed,190);assert.equal(c.settings.hints,false);
 assert.equal(c.mechanics.fuelSeconds,150);assert.equal(c.mechanics.landingSpeed,120);
 assert.equal(compiled.levels[0].world.id,'nebula');
 assert.ok(!calls.some(c=>/publish|reward|appearance|auth/.test(c)));
 await writeFile(output+'.evidence.json',JSON.stringify({passed:true,calls,authored,engineVersion:compiled.levels[0].version,output},null,2));
 console.log('PASS: real Studio controls generate bounded bilingual letters, hints, world, speed and landing settings; unchanged compiler accepts native preview. No publication.');
} finally {
 socket?.close();const exited=new Promise(r=>browser.once('exit',r));browser.kill();await exited;
 server.close();await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
