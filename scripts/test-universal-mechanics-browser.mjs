// Synthetic acceptance only; requires the loopback Factory harness on port 8788.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import WebSocket from 'ws';
const base='http://127.0.0.1:8788';
assert.equal((await (await fetch(base+'/fixture/health')).json()).synthetic,true);
const profile=await mkdtemp(join(tmpdir(),'factory-browser-'));
const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
let socket;
try{
 const endpoint=await new Promise((resolve,reject)=>{let output='';const timeout=setTimeout(()=>reject(Error('Chrome startup timeout')),15000);browser.stderr.on('data',bytes=>{output+=bytes;const m=output.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timeout);resolve(m[1]);}});browser.on('error',reject);});
 socket=new WebSocket(endpoint);await new Promise(r=>socket.once('open',r));let next=0;const pending=new Map(),errors=[];
 socket.on('message',raw=>{const message=JSON.parse(raw);if(message.id){const call=pending.get(message.id);pending.delete(message.id);message.error?call.reject(Error(message.error.message)):call.resolve(message.result);}else if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);});
 const command=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,sessionId}));});
 const {targetId}=await command('Target.createTarget',{url:'about:blank'}),{sessionId}=await command('Target.attachToTarget',{targetId,flatten:true});
 const send=(method,params)=>command(method,params,sessionId);
 await send('Runtime.enable');await send('Page.enable');
 const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
 const wait=async expression=>{const end=Date.now()+15000;while(!await evaluate(expression)){if(Date.now()>end)throw Error('Timed out: '+expression);await new Promise(r=>setTimeout(r,50));}};
 const click=async id=>{await evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);};
 await send('Emulation.setDeviceMetricsOverride',{width:1250,height:1000,deviceScaleFactor:1,mobile:false});

 const set=async(id,value)=>evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});if(!e)throw Error('Missing ${id}');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change'));})()`);
 const go=async n=>evaluate(`document.querySelectorAll('#steps button')[${n}].click()`);
 const ready=async()=>{await send('Page.navigate',{url:base+'/admin/game-studio'});await wait("document.getElementById('notice').textContent.includes('Ready.')");};
 const newGame=async(engine,title,af)=>{await ready();await evaluate(`document.querySelector('[data-engine=${engine}]').click()`);await go(1);await set('title-en',title);await set('title-af',af);};
 const importRows=async text=>{await go(1);await set('content-import',text);await click('import-rows');};
 const rule=async(condition,en,af,prompt,promptAf)=>{await go(3);await set('condition',condition);if(en!=null){await set('rule-en',en);await set('rule-af',af);}await set('prompt-en',prompt);await set('prompt-af',promptAf);};
 const publish=async(category,skill)=>{await go(4);await set('category',category);await set('skill',skill);await set('audience','public');await go(6);await evaluate("document.getElementById('reviewed').checked=true");await click('publish');await wait("document.getElementById('notice').textContent.includes('Published revision 1')||document.getElementById('notice').classList.contains('error')");assert.match(await evaluate("document.getElementById('notice').textContent"),/Published revision 1/);return evaluate("document.getElementById('saved').value");};
 const ids=[];
 const clickText=async text=>evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(text)});if(!b)throw Error('Missing button');b.click();})()`);
 await newGame('runner','Movement · Runner','Beweging · Hardloper');await importRows('apple,appel,picture_apple');await go(2);await click('add-gap');await set('gap-width-0',100);await clickText('Add checkpoint');await set('object-anchor','zone_21');ids.push(await publish('reading','phonics'));
 await newGame('racer','Movement · Racer','Beweging · Renmotor');await go(2);await set('race-laps',2);await set('race-distance',750);await clickText('Add checkpoint');await set('object-anchor','zone_8');await clickText('Add checkpoint');await set('object-anchor','zone_5');ids.push(await publish('maths','arithmetic'));
 await newGame('explorer','Movement · Explorer','Beweging · Verkenner');await go(2);await click('add-doors');await set('door-goal-0',1);await click('add-dialogue');await set('dialogue-0-en','Find the apple to open the door.');await set('dialogue-0-af','Vind die appel om die deur oop te maak.');ids.push(await publish('reading','phonics'));
 await newGame('rocket','Movement · Rocket','Beweging · Vuurpyl');await go(2);await set('fuel-seconds',30);await set('landing-speed',90);await set('require-landing','yes');await click('add-landing-pad');await set('object-anchor','zone_9');ids.push(await publish('reading','phonics'));
 const session=await (await fetch(base+'/fixture/session?role=centre')).json(),headers={Authorization:'Bearer '+session.token};
 const games=(await (await fetch(base+'/v1/app/arcade/students/student-a/factory/v1/games',{headers})).json()).items.filter(i=>ids.includes(i.game.id));assert.equal(games.length,4);
 for(const p of games){assert.equal(p.game.levels[0].version,5);assert.equal(p.game.levels[0].config.model,3);}
 const config=engine=>games.find(p=>p.game.levels[0].engine===engine).game.levels[0].config;
 assert.equal(config('runner').mechanics.gaps.length,1);assert.equal(config('racer').mechanics.laps,2);assert.equal(config('racer').objects.filter(o=>o.role==='checkpoint').length,2);assert.equal(config('explorer').mechanics.dialogue[0].message.af,'Vind die appel om die deur oop te maak.');assert.equal(config('rocket').mechanics.requireLanding,true);
 await writeFile('/private/tmp/universal-mechanics-browser.json',JSON.stringify(games,null,2));
 await go(2);await evaluate("document.querySelector('#fuel-seconds').closest('section').scrollIntoView({block:'center'})");await writeFile('/private/tmp/universal-mechanics-studio.png',Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 assert.deepEqual(errors,[]);console.log('PASS: Runner gap and recovery, Racer laps and checkpoints, Explorer door and bilingual dialogue, Rocket fuel and landing authored and published through Studio controls.');
}finally{socket?.close();browser.kill();await new Promise(r=>browser.once('exit',r));await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
