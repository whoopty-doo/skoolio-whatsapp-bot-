// Isolated acceptance of the exact release Worker and compiled Flutter player.
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {accessHeaders,adminConfig} from '../test/helpers.js';
import {learningBrowser} from './learning-browser-session.mjs';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,join,extname} from 'node:path';
const [releaseArg,assetsArg,evidenceArg]=process.argv.slice(2);
assert.ok(releaseArg&&assetsArg&&evidenceArg);
const release=resolve(releaseArg),assets=resolve(assetsArg),evidence=resolve(evidenceArg);
await mkdir(evidence,{recursive:true});
const auth=await accessHeaders({exp:Math.floor(Date.now()/1000)+3600});
const types={'.html':'text/html','.js':'application/javascript','.wasm':'application/wasm','.json':'application/json','.png':'image/png','.wav':'audio/wav','.woff2':'font/woff2','.otf':'font/otf','.ttf':'font/ttf'};
const runtime=new Miniflare(convertV4MiniflareOptions({modulesRoot:release,modules:['candidate.mjs','factory-workspace.generated.js','factory-preview.js'].map(path=>({type:'ESModule',path:join(release,path)})),compatibilityDate:'2026-09-21',compatibilityFlags:['nodejs_compat'],name:'factory-player-browser',kvNamespaces:['NOTES_KV'],durableObjects:{SUPPORT_COORDINATOR:{className:'SupportCoordinator',useSQLite:true},LEARNING_FACTORY_WORKSPACE:{className:'LearningFactoryCoordinator',useSQLite:true}},bindings:{...adminConfig,ENVIRONMENT:'production',LEARNING_FACTORY_HOSTED_ENABLED:'true',FACTORY_VISUAL_ENABLED:'true',OPENAI_API_KEY:'synthetic-test-only',OPENAI_MODEL:'gpt-4o-mini',GEMINI_API_KEY:'synthetic-transport-marker',NANO_BANANA_MODEL:'gemini-nano-banana-2.1',TINA_ELEVENLABS_API_KEY:'synthetic-transport-marker',TINA_ELEVENLABS_VOICE_ID:'approved-tina'},serviceBindings:{FACTORY_PREVIEW_ASSETS:async request=>{
 const path=decodeURIComponent(new URL(request.url).pathname).replace(/^\/factory-preview\//,'');
 const file=resolve(assets,path);if(!file.startsWith(assets+'/'))return new Response('Not found',{status:404});
 try{const bytes=await readFile(file);return new Response(request.method==='HEAD'?null:bytes,{headers:{'Content-Type':types[extname(file)]||'application/octet-stream'}});}catch{return new Response('Not found',{status:404});}
}},outboundService:async request=>{
 if(request.url==='https://team.example.com/cdn-cgi/access/certs')return Response.json({keys:[auth.publicJwk]});
 if(request.url.startsWith('https://api.elevenlabs.io/v1/text-to-speech/'))return new Response(Buffer.alloc(64000));
 if(request.url.startsWith('https://api.elevenlabs.io/')){const b=Buffer.alloc(64044);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(64000,28);b.writeUInt16LE(4,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);return new Response(b);}
 throw Error('External network forbidden: '+new URL(request.url).hostname);
}}));
const server=createServer(async(req,res)=>{try{
 if(req.url==='/fixture/health'){res.setHeader('Content-Type','application/json');res.end('{"synthetic":true}');return;}
 const chunks=[];for await(const c of req)chunks.push(c);
 const response=await runtime.dispatchFetch('http://127.0.0.1:'+server.address().port+req.url,{method:req.method,headers:{...req.headers,...(/^\/(admin(?:\/|$)|api\/admin\/)/.test(req.url)?auth.headers:{})},...chunks.length?{body:Buffer.concat(chunks)}:{}});
 res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
}catch(error){res.writeHead(500);res.end('Isolated test request failed');console.error(error.message);}});
let browser;
try{
 assert.equal((await runtime.dispatchFetch('https://example.com/factory-preview/index.html')).status,401);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 const api=async(path,body)=>{const r=await fetch(base+'/api/admin/game-studio/learning/'+path,{method:body?'POST':'GET',headers:{Origin:base,'Content-Type':'application/json'},...body?{body:JSON.stringify(body)}:{}});const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data;};


 browser=await learningBrowser(base,{startupTimeoutMs:60000});const {evaluate:e,wait,click,set,send}=browser;
 const ready=()=>wait("document.body.getAttribute('aria-busy')==='false'");
 const screenshot=async name=>{console.log('Verified screen: '+name);await e('window.scrollTo(0,0)');await send('Page.captureScreenshot',{format:'png'}).then(r=>writeFile(join(evidence,name+'.png'),Buffer.from(r.data,'base64')));};
 await send('Page.navigate',{url:base+'/admin/game-studio'});await wait("document.getElementById('dashboard-pack')?.disabled===false");
 await click('create-pack');await ready();await click('save-draft');await ready();
 const record=(await api('catalogue')).records.filter(r=>r.kind==='skillPack').at(-1),id=record.id,v=record.body.definition.v2;
 const mission=v.missions.find(m=>m.id===v.pack.weeks[0].mission),practice=mission.stages.findIndex(s=>s.kind==='practice'),game=v.games.find(g=>g.id===mission.stages[practice].game),question=game.content.items[0];
 assert.ok((await api('catalogue')).skillPackAudio);
 await click('flow-step-2');await ready();await click('flow-media-audio');await ready();
 assert.equal(await e("document.getElementById('flow-generate-audio').disabled"),true);
 await set('flow-audio-text','a');assert.equal(await e("document.getElementById('flow-generate-audio').disabled"),false);
 // Real HTML audio decoding is exercised; provider transport is explicitly synthetic.
 const approve=async(target)=>{await send('Runtime.evaluate',{expression:"document.getElementById('flow-audio-player').play()",awaitPromise:true,userGesture:true});await wait("document.getElementById('flow-audio-player').ended",20000);await e("document.getElementById('flow-media-reviewed').checked=true");await set('flow-asset-target',target);await click('flow-approve-media');await wait("document.getElementById('notice').textContent==='Approved asset attached to this draft.'");await ready();};
 await click('flow-generate-audio');await wait("document.getElementById('notice').textContent.startsWith('Audio ready')");await ready();await approve('prompt');
 let saved=(await api('catalogue')).records.find(r=>r.id===id),narration=saved.body.definition.audio.stages[0].instruction;
 assert.ok(narration);await screenshot('teaching-narration-attached');
 await click('outline-activity-'+practice);await ready();await click('flow-media-library');await ready();await click('flow-use-'+narration.id);await ready();await set('flow-asset-target','item:'+question.id);await click('flow-approve-media');await ready();
 await click('flow-media-audio');await ready();await set('flow-audio-kind','soundEffect');await set('flow-audio-text','A cheerful short chime');await click('flow-generate-audio');await wait("document.getElementById('notice').textContent.startsWith('Audio ready')");await ready();await approve('effect:correct');
 const bundle=await api('preview',{id});assert.equal(bundle.learningAudio.stages.length,2);assert.equal(bundle.learningAudio.clips.length,2);assert.deepEqual(bundle.definition,v);await writeFile(join(evidence,'skill-audio-preview.json'),JSON.stringify(bundle));
 await screenshot('question-and-effect-attached');
 await click('tab-preview');await ready();await click('open-preview');await wait("document.getElementById('preview-status')?.textContent.startsWith('Ready to play')",90000);await ready();
 await e("document.getElementById('runtime-preview').scrollIntoView({block:'start'});document.getElementById('runtime-preview').contentDocument.querySelector('flt-semantics-placeholder')?.click()");
 const player="document.getElementById('runtime-preview').contentDocument";
 const tap=async label=>{const expression=`(()=>{const f=document.getElementById('runtime-preview'),d=f.contentDocument,b=[...d.querySelectorAll('[role=button],button')].find(e=>(e.getAttribute('aria-label')||e.innerText).trim()===${JSON.stringify(label)}&&e.getAttribute('aria-disabled')!=='true');if(!b)return null;const r=b.getBoundingClientRect(),p=f.getBoundingClientRect();return {x:p.x+r.x+r.width/2,y:p.y+r.y+r.height/2};})()`;await wait(expression,20000);const point=await e(expression);await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});await new Promise(r=>setTimeout(r,300));};
 await wait(player+".body.innerText.includes('Listen to instructions')");
 await e(`(()=>{const w=${player}.defaultView;w.__audioEvents=[];w.__factoryMedia=[];const original=w.HTMLMediaElement.prototype.play;w.HTMLMediaElement.prototype.play=function(...args){if(!w.__factoryMedia.includes(this)){w.__factoryMedia.push(this);for(const type of ['playing','timeupdate','ended','error'])this.addEventListener(type,()=>w.__audioEvents.push({type,src:this.currentSrc,time:this.currentTime,volume:this.volume,sourceAttribute:this.getAttribute('src'),errorCode:this.error?.code}));}return original.apply(this,args);};})()`);
 await tap('Listen to instructions');await wait(player+".defaultView.__audioEvents.some(x=>x.type==='ended'&&x.src.startsWith('blob:'))",20000);
 await tap('Listen to instructions');await tap('Pause');await wait(player+".body.innerText.includes('Resume')");assert.ok(await e(`${player}.defaultView.__factoryMedia.every(m=>m.paused)`));await tap('Resume');
 await tap('Start the mission');await tap('Listen to question');await wait(`Array.from(${player}.querySelectorAll('[aria-label]')).some(e=>e.getAttribute('aria-label').includes('Listening is recorded as support for this question.'))`);
 for(const letter of question.answer)await tap(letter);await tap('Check word');
 await wait(player+".defaultView.__audioEvents.some(x=>x.type==='playing'&&x.src.startsWith('blob:')&&Math.abs(x.volume-.38)<.02)",20000);
 await wait(player+".defaultView.__audioEvents.some(x=>x.type==='ended'&&x.src.startsWith('blob:')&&Math.abs(x.volume-.38)<.02)",20000);await screenshot('actual-player-audio');
 const events=await e(player+'.defaultView.__audioEvents');assert.ok(events.some(x=>x.type==='timeupdate'&&x.time>0&&x.src.startsWith('blob:')));assert.ok(events.filter(x=>x.type==='error').every(x=>x.sourceAttribute===''&&x.errorCode===4),'Only media_kit empty-src stop notifications are allowed; actual clip decode errors fail');await writeFile(join(evidence,'playback-events.json'),JSON.stringify(events,null,2));
 await click('flow-step-5');await ready();await set('review-note','Isolated acceptance: audio review, question playback, local effects and pause/resume checked.');await click('approve');await wait("document.getElementById('notice').textContent==='Recorded approve.'");await click('publish-test');await wait("document.getElementById('notice').textContent.includes('immutable TEST revision')");
 saved=(await api('catalogue')).records.find(r=>r.id===id);assert.equal(saved.publishedRevision,1);assert.ok(saved.publishedBody.definition.audio);
 await click('flow-step-1');await ready();await set('prompt-'+question.id,question.prompt+' Read carefully.');await click('save-draft');await ready();
 saved=(await api('catalogue')).records.find(r=>r.id===id);const binding=saved.body.definition.audio.stages.find(s=>s.stage===mission.stages[practice].id);assert.equal(binding.items[question.id],undefined);assert.ok(binding.effects.correct);assert.ok(saved.body.definition.audio.stages[0].instruction);assert.ok(saved.publishedBody.definition.audio.stages.find(s=>s.stage===binding.stage).items[question.id]);
 await click('flow-step-2');await ready();await click('flow-remove-audio-effect:correct');await ready();saved=(await api('catalogue')).records.find(r=>r.id===id);assert.equal(saved.body.definition.audio.stages.length,1);
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await screenshot('mobile-audio-authoring');assert.ok(await e('document.documentElement.scrollWidth<=innerWidth+1'));
 assert.deepEqual(browser.errors,[]);assert.equal(browser.network.filter(u=>/^https?:/.test(u)&&!u.startsWith(base+'/')).length,0);
 const result={status:'PASS',scope:'Synthetic isolated authoring acceptance with actual compiled Flutter player and browser media decoding',singleLetterNarration:true,approvedPinnedAttachments:true,instructionsQuestionsAndEffects:true,actualBlobPlayback:true,pauseStopsAudio:true,immutableTestPublication:true,staleNarrationDetached:true,removePreservesLibrary:true,phoneLayout:true,liveProviders:false,ownerSession:false};
 await writeFile(join(evidence,'acceptance.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){if(browser){await writeFile(join(evidence,'failure-state.json'),JSON.stringify(await browser.evaluate("({notice:document.getElementById('notice')?.textContent,html:document.getElementById('workspace')?.innerHTML,player:document.getElementById('runtime-preview')?.contentDocument?.body?.innerText,playback:document.getElementById('runtime-preview')?.contentWindow?.__audioEvents})")));await writeFile(join(evidence,'browser-errors.json'),JSON.stringify(browser.errors,null,2));await browser.send('Page.captureScreenshot',{format:'png'}).then(r=>writeFile(join(evidence,'failure.png'),Buffer.from(r.data,'base64')));}throw error;
}finally{await browser?.close();await new Promise(r=>server.close(r));await runtime.dispose();}
