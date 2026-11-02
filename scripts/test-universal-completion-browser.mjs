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
 const click=async id=>{await wait("!document.getElementById('next').disabled");await evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);await wait("!document.getElementById('next').disabled");};
 await send('Emulation.setDeviceMetricsOverride',{width:1250,height:1000,deviceScaleFactor:1,mobile:false});

 const set=async(id,value)=>evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});if(!e)throw Error('Missing ${id}');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change'));})()`);
 const go=async n=>{await wait("!document.getElementById('next').disabled");return evaluate(`document.querySelectorAll('#steps button')[${n}].click()`);};
 const ready=async()=>{await send('Page.navigate',{url:base+'/admin/game-studio'});await wait("document.getElementById('notice').textContent.includes('Ready.')");};
 const newGame=async(engine,title,af)=>{await ready();await evaluate(`document.querySelector('[data-engine=${engine}]').click()`);await go(1);await set('title-en',title);await set('title-af',af);};
 const importRows=async text=>{await go(1);await set('content-import',text);await click('import-rows');};
 const rule=async(condition,en,af,prompt,promptAf)=>{await go(3);await set('condition',condition);if(en!=null){await set('rule-en',en);await set('rule-af',af);}await set('prompt-en',prompt);await set('prompt-af',promptAf);};
 const publish=async(category,skill)=>{await go(4);await set('category',category);await set('skill',skill);await set('audience','public');await go(6);await evaluate("document.getElementById('reviewed').checked=true");await click('publish');await wait("document.getElementById('notice').textContent.includes('Published revision 1')||document.getElementById('notice').classList.contains('error')");assert.match(await evaluate("document.getElementById('notice').textContent"),/Published revision 1/);return evaluate("document.getElementById('saved').value");};

 const ids=[];
 const clickText=async text=>evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(text)});if(!b)throw Error('Missing button');b.click();})()`);
 const uploadAudio=async()=>{
  await go(1);await evaluate("document.getElementById('audio-file').closest('details').open=true");
  const {root}=await send('DOM.getDocument');const {nodeId}=await send('DOM.querySelector',{nodeId:root.nodeId,selector:'#audio-file'});
  await send('DOM.setFileInputFiles',{nodeId,files:['/private/tmp/factory-mechanics/test-tone.wav']});
  await set('audio-title','Synthetic test tone');await set('audio-provenance','Synthetic sine-wave test audio, not a spoken curriculum.');await set('audio-usage','public');await evaluate("document.getElementById('audio-rights').checked=true");await click('audio-upload');await wait("document.getElementById('notice').textContent.startsWith('Uploaded.')");await send('Runtime.evaluate',{expression: "document.getElementById('audio-review-player').play()",awaitPromise:true,userGesture:true});await wait("document.getElementById('audio-review-player').currentTime>0");await click('audio-approve');await wait("document.getElementById('notice').textContent.startsWith('Approved audio added')");
  return evaluate("document.getElementById('item-audio-0-en').options[1].value");
 };
 await newGame('memory','Sound picture acceptance','Klankprent aanvaarding');await importRows('apple,appel,picture_apple,fruit\nball,bal,symbol_ball,toys');
 const clip=await uploadAudio();for(const i of [0,1])for(const lang of ['en','af'])await set('item-audio-'+i+'-'+lang,clip);
 await go(3);await set('memory-mode','sound_picture');await set('condition','pair');ids.push(await publish('memory','visual_memory'));
 await newGame('target','Listen and choose acceptance','Luister en kies aanvaarding');await importRows('apple,appel,picture_apple,fruit\nball,bal,symbol_ball,toys');
 await go(1);await evaluate("document.getElementById('browse-audio').closest('details').open=true");await click('browse-audio');await wait("[...document.querySelectorAll('button')].some(b=>b.textContent==='Synthetic test tone · public')");await clickText('Synthetic test tone · public');await wait("!document.getElementById('next').disabled");
 await rule('answer','apple','appel','Listen, then choose apple.','Luister en kies dan appel.');await set('interaction','select');for(const lang of ['en','af'])await set('prompt-audio-'+lang,clip);ids.push(await publish('focus','selective_attention'));
 await newGame('explorer','Owned avatar acceptance','Avatar-eienaarskap aanvaarding');await go(2);await evaluate("document.getElementById('asset-file').closest('details').open=true");
 await evaluate(`(async()=>{const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;const c=canvas.getContext('2d');c.fillStyle='#407ab0';c.fillRect(0,0,32,32);const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));const transfer=new DataTransfer();transfer.items.add(new File([blob],'synthetic.png',{type:'image/png'}));document.getElementById('asset-file').files=transfer.files;})()`);
 await set('asset-alt','Synthetic blue explorer');await set('asset-provenance','Original synthetic canvas fixture with public test rights.');await set('asset-usage','public');await evaluate("document.getElementById('asset-rights').checked=true");await clickText('Upload for review');await wait("document.getElementById('notice').textContent.includes('Uploaded')");await clickText('Approve and use picture');await wait("document.getElementById('notice').textContent.includes('Approved')");
 await evaluate("document.getElementById('browse-looks').closest('details').open=true");await click('browse-looks');await wait("!!document.getElementById('look-item')");await set('look-item','avatar_captain');await evaluate("document.getElementById('look-reviewed').checked=true");await click('look-approve');await wait("document.getElementById('notice').textContent.includes('mapping approved')");await click('browse-looks');await wait("!!document.querySelector('[data-look]') && !document.querySelector('[data-look]').disabled && !document.getElementById('next').disabled");await wait("document.querySelector('[data-look] img').naturalWidth===32");await evaluate("document.querySelector('[data-look]').click()");await wait("!document.getElementById('next').disabled");ids.push(await publish('reading','word_recognition'));
 const session=await (await fetch(base+'/fixture/session?role=centre')).json(),headers={Authorization:'Bearer '+session.token};
 const catalogue=await (await fetch(base+'/v1/app/arcade/students/student-a/factory/v1/games',{headers})).json(),games=catalogue.items.filter(p=>ids.includes(p.game.id));
 assert.equal(games.length,3);const memory=games.find(p=>p.game.levels[0].engine==='memory');assert.equal(memory.game.levels[0].config.memoryMode,'sound_picture');assert.equal(memory.game.levels[0].config.bank.items.length,2);assert.equal(games.find(p=>p.game.levels[0].engine==='target').game.levels[0].config.promptAudio.en,clip);assert.equal(games.find(p=>p.game.levels[0].engine==='explorer').game.levels[0].config.appearance.storeItemId,'avatar_captain');
 await writeFile('/private/tmp/universal-completion-browser.json',JSON.stringify(games,null,2));await writeFile('/private/tmp/universal-completion-studio.png',Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 assert.deepEqual(errors,[]);console.log('PASS: approved audio, bilingual sound/picture memory, listening question and ownership-bound avatar authored and published through Studio.');
}finally{socket?.close();browser.kill();await new Promise(r=>browser.once('exit',r));await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
