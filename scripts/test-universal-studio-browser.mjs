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
 const publish=async(category,skill)=>{await go(4);await set('category',category);await set('skill',skill);await set('editorial-order',7);await set('creator-credit','PlaySmart');await set('audience','public');await go(6);await evaluate("document.getElementById('reviewed').checked=true");await click('publish');await wait("document.getElementById('notice').textContent.includes('Published revision 1')||document.getElementById('notice').classList.contains('error')");assert.match(await evaluate("document.getElementById('notice').textContent"),/Published revision 1/);return evaluate("document.getElementById('saved').value");};
 const proofIds=[];
 await newGame('rocket','A · Rocket spelling','A · Vuurpylspelling');await rule('sequence','A, P, P, L, E','A, P, P, E, L','Spell APPLE.','Spel APPEL.');await click('derive-sequence');await click('bonus-stars');proofIds.push(await publish('words','spelling'));
 await newGame('rocket','B · Rocket phonics','B · Vuurpylklanke');await rule('first_letter','A','A','Collect the picture beginning with A.','Versamel die prent wat met A begin.');proofIds.push(await publish('reading','phonics'));
 await newGame('rocket','C · Rocket maths','C · Vuurpylwiskunde');await importRows('7,7\n8,8\n9,9\n10,10');await rule('answer','9','9','6 + 3 = ?','6 + 3 = ?');proofIds.push(await publish('maths','arithmetic'));
 await newGame('build','D · Drag phonics','D · Sleepklanke');await importRows('apple,appel,picture_apple\nant,mier,symbol_ant\nball,bal,symbol_ball\nboat,boot,symbol_boat\ncat,kat,symbol_cat\ncow,koei,symbol_cow\ndog,hond,symbol_dog\negg,eier,symbol_egg\nfish,vis,symbol_fish\nfrog,padda,picture_frog');await go(3);await set('prompt-en','Drag each picture to its starting-letter crater.');await set('prompt-af','Sleep elke prent na sy beginklankkrater.');
 // Afrikaans initial letters differ: the displayed target explicitly names both accepted initials.
 await set('target_0-af','A / M');await set('target_5-af','V / P');proofIds.push(await publish('reading','phonics'));
 await evaluate("document.getElementById('load-reward-policy').closest('details').open=true");await click('load-reward-policy');await wait("!!document.getElementById('reward-reviewed')");await evaluate("document.getElementById('reward-reviewed').checked=true");await click('approve-reward-binding');await wait("document.getElementById('notice').textContent.includes('Account activation remains separate')");
 await newGame('memory','E · Memory vocabulary','E · Geheuewoordeskat');await go(3);await set('prompt-en','Match the picture and word.');await set('prompt-af','Pas die prent en woord.');proofIds.push(await publish('memory','vocabulary'));
 await newGame('runner','F · Runner reading','F · Hardloperlees');await importRows('the,die\nand,en\nwas,was');await rule('answer','the','die','Jump through the THE gate.','Spring deur die DIE-hek.');await set('interaction','jump_through');proofIds.push(await publish('reading','word_recognition'));
 await newGame('racer','G · Racer maths','G · Renwiskunde');await importRows('7,7\n8,8\n9,9\n10,10');await rule('answer','9','9','Drive through the answer to 6 + 3.','Ry deur die antwoord op 6 + 3.');proofIds.push(await publish('maths','arithmetic'));
 await newGame('explorer','H · S object hunt','H · S-voorwerpsoektog');await importRows('star,ster,picture_star\nsun,son,picture_sun\nsnake,slang,symbol_snake\napple,appel,picture_apple');await rule('first_letter','S','S','Find all objects beginning with S.','Vind al die voorwerpe wat met S begin.');await set('goal-en',3);await set('goal-af',3);proofIds.push(await publish('reading','phonics'));
 await newGame('target','Target · Answer tracking','Teiken · Antwoordvolging');await importRows('7,7\n8,8\n9,9\n10,10');await rule('answer','9','9','Hit the answer to 6 + 3.','Tref die antwoord op 6 + 3.');proofIds.push(await publish('maths','arithmetic'));
 await click('missions-tab');await set('composition-title-en','I · Full adventure');await set('composition-title-af','I · Volledige avontuur');await set('composition-category','reading');await set('composition-editorial-order',20);
 for(const index of [4,2]){await set('stage-game',proofIds[index]);await click('add-game-stage');}
 await set('scene-preset','launch');await set('scene-world','moon');await set('scene-duration','normal');await click('add-scene');await set('stage-game',proofIds[0]);await click('add-game-stage');await set('scene-preset','landing');await click('add-scene');for(const index of [7,5,3]){await set('stage-game',proofIds[index]);await click('add-game-stage');}await set('scene-kind','result');await set('scene-preset','mission_complete');await click('add-scene');await click('choose-unlock');await wait("!!document.getElementById('scene-unlock')");await set('scene-unlock','xp_store_'+'a'.repeat(32));await set('scene-en','Crystal planet discovered.');await set('scene-af','Kristalplaneet ontdek.');await click('add-scene');await click('publish-composition');await wait("document.getElementById('notice').textContent.includes('Journey published')||document.getElementById('notice').classList.contains('error')");assert.match(await evaluate("document.getElementById('notice').textContent"),/Journey published/);
 await evaluate("document.getElementById('load-progression').closest('details').open=true");await click('load-progression');await wait("!!document.getElementById('progression-reviewed')");await evaluate("document.getElementById('progression-reviewed').checked=true");await click('approve-progression');await wait("document.getElementById('notice').textContent.includes('No item or currency was granted')");
 await writeFile('/private/tmp/universal-studio-composer.png',Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 // Create a separate Skill Set, exercising reset rather than mutating the Adventure.
 await set('composition-saved','');await set('composition-kind','skillSet');await set('composition-title-en','Reading foundations');await set('composition-title-af','Leesgrondslag');
 assert.equal(await evaluate("document.getElementById('scene-kind')===null"),true);
 for(const index of [8,3,0]){await set('stage-game',proofIds[index]);await click('add-game-stage');}
 await click('publish-composition');await wait("document.getElementById('notice').textContent.includes('Journey published')||document.getElementById('notice').classList.contains('error')");assert.match(await evaluate("document.getElementById('notice').textContent"),/Journey published/);
 assert.equal(await evaluate("document.querySelectorAll('[data-preview-stage]').length"),3);
 const session=await (await fetch(base+'/fixture/session?role=centre')).json(),headers={Authorization:'Bearer '+session.token};
 const games=(await (await fetch(base+'/v1/app/arcade/students/student-a/factory/v1/games',{headers})).json()).items.filter(i=>proofIds.includes(i.game.id));assert.equal(games.length,9);assert.ok(games.every(g=>g.listing.editorialOrder===7&&g.listing.creatorCredit==='PlaySmart'));
 const journeys=(await (await fetch(base+'/v1/app/arcade/students/student-a/factory/v1/compositions',{headers})).json()).items;
 assert.equal(journeys.length,2);assert.equal(journeys.find(j=>j.definition.kind==='mission').definition.category,'reading');assert.equal(journeys.find(j=>j.definition.kind==='mission').definition.listing.editorialOrder,20);assert.equal(journeys.find(j=>j.definition.kind==='skillSet').definition.stages.length,3);const launch=journeys.find(j=>j.definition.kind==='mission').definition.stages[2];assert.equal(launch.world,'moon');assert.equal(launch.duration,'normal');
 await writeFile('/private/tmp/universal-studio-proofs.json',JSON.stringify({games,compositions:journeys},null,2));
 // Content edit through the same editor, with immutable old revision retained.
 await click('games-tab');await set('saved',proofIds[2]);await go(3);await set('rule-en','8');await set('rule-af','8');await set('prompt-en','5 + 3 = ?');await set('prompt-af','5 + 3 = ?');await go(6);await evaluate("document.getElementById('reviewed').checked=true");await click('publish');await wait("document.getElementById('notice').textContent.includes('Published revision 2')");
 const old=(await (await fetch(base+`/v1/app/arcade/students/student-a/factory/v1/games/${proofIds[2]}/revisions/1`,{headers})).json()).item;assert.deepEqual(old.game.levels[0].config.rules[0].values.en,['9']);
 await go(2);await writeFile('/private/tmp/universal-studio-scene.png',Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 assert.deepEqual(errors,[]);console.log('PASS: nine games, multi-engine adventure and Skill Set authored and published using Studio controls; content edit creates immutable revision 2.');
}finally{socket?.close();browser.kill();await new Promise(r=>browser.once('exit',r));await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
